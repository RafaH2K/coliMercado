const pool = require("../config/db");
const stripe = require("../config/stripe");
const storage = require("../lib/storage");
const { sendEmail } = require("../config/email");

// Fire-and-forget: un correo que falla no debe tumbar la aprobación.
async function notifyStoreApproved(store) {
    try {
        const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [store.owner_id]);
        if (!rows[0]) return;
        await sendEmail({
            to: rows[0].email,
            subject: `¡${store.name} fue aprobado!`,
            html: `<p>Tu negocio <strong>${store.name}</strong> ya fue aprobado y aparece en el mercado.</p>`,
        });
    } catch (err) {
        console.error("notifyStoreApproved error:", err.message);
    }
}

const STORE_ADMIN_FIELDS = `
    s.id, s.name, s.description, s.city, s.phone, s.is_active, s.created_at,
    u.name AS owner_name, u.email AS owner_email
`;

async function listPendingStores(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT ${STORE_ADMIN_FIELDS}
             FROM stores s JOIN users u ON u.id = s.owner_id
             WHERE s.is_admin_approved = FALSE
             ORDER BY s.created_at ASC`
        );
        res.json(rows);
    } catch (err) {
        console.error("admin.listPendingStores error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Negocios ya aprobados, para el panel de suspender/reactivar. Los
// suspendidos primero, para que salten a la vista.
async function listApprovedStores(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT ${STORE_ADMIN_FIELDS}
             FROM stores s JOIN users u ON u.id = s.owner_id
             WHERE s.is_admin_approved = TRUE
             ORDER BY s.is_active ASC, s.name ASC`
        );
        res.json(rows);
    } catch (err) {
        console.error("admin.listApprovedStores error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function approveStore(req, res) {
    try {
        const { rows } = await pool.query(
            `UPDATE stores SET is_admin_approved = TRUE WHERE id = $1 AND is_admin_approved = FALSE RETURNING *`,
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: "Negocio no encontrado o ya estaba aprobado" });
        notifyStoreApproved(rows[0]);
        res.json(rows[0]);
    } catch (err) {
        console.error("admin.approveStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Rechazar borra el negocio pendiente. Si ya tiene productos/servicios/horario
// cargados la borrada falla por llave foránea; en ese caso se avisa en vez
// de tronar, en vez de cascadear borrados de contenido real del dueño.
async function rejectStore(req, res) {
    try {
        const { rows } = await pool.query(
            `DELETE FROM stores WHERE id = $1 AND is_admin_approved = FALSE RETURNING id`,
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: "Negocio no encontrado o ya estaba aprobado" });
        res.status(204).send();
    } catch (err) {
        if (err.code === "23503") {
            return res.status(409).json({
                error: "Este negocio ya tiene productos, servicios u horario configurados; no se puede rechazar automáticamente.",
            });
        }
        console.error("admin.rejectStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Suspende/reactiva un negocio YA aprobado. Es una bandera separada de
// is_admin_approved a propósito: si reutilizara esa misma columna, suspender
// un negocio activo lo haría reaparecer en la lista de pendientes.
async function setActive(req, res) {
    const { is_active } = req.body;
    if (typeof is_active !== "boolean") {
        return res.status(400).json({ error: "is_active debe ser true o false" });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE stores SET is_active = $1 WHERE id = $2 AND is_admin_approved = TRUE RETURNING *`,
            [is_active, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: "Negocio no encontrado o aún no está aprobado" });
        res.json(rows[0]);
    } catch (err) {
        console.error("admin.setActive error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Elimina un negocio YA aprobado con todo su contenido (a diferencia de
// rejectStore, que solo borra pendientes sin contenido y truena si hay FK).
// products/orders no tienen ON DELETE CASCADE hacia stores, y payments/
// cart_items/appointments tampoco lo tienen hacia orders/products, así que
// hay que borrar en orden manualmente dentro de una transacción; lo demás
// (business_hours, reviews, favorites, product_images...) sí cascadea solo.
async function purgeStore(req, res) {
    const storeId = req.params.id;
    try {
        const { rows: storeRows } = await pool.query(
            `SELECT logo_url, stripe_subscription_id FROM stores WHERE id = $1`,
            [storeId]
        );
        const store = storeRows[0];
        if (!store) return res.status(404).json({ error: "Negocio no encontrado" });

        // Cancelar la suscripción de Stripe ANTES de borrar la tienda, no
        // después: una vez que el DELETE hace commit, stripe_subscription_id
        // desaparece de la base para siempre. Si Stripe falla aquí (timeout,
        // blip de red), se aborta la purga sin tocar nada -- el admin puede
        // reintentar -- en vez de dejar una suscripción cobrando sin ninguna
        // fila que permita rastrearla o cancelarla después.
        // resource_missing = la suscripción ya no existe en Stripe (el dueño
        // ya la había cancelado, o un intento de purga anterior sí alcanzó a
        // cancelarla pero falló después) -- no es un error real, se continúa.
        if (store.stripe_subscription_id) {
            try {
                await stripe.subscriptions.cancel(store.stripe_subscription_id);
            } catch (err) {
                if (err.code !== "resource_missing") {
                    console.error("admin.purgeStore: no se pudo cancelar la suscripción:", err.message);
                    return res.status(502).json({
                        error: "No se pudo cancelar la suscripción de Stripe de este negocio. Intenta de nuevo; la tienda no se borró.",
                    });
                }
            }
        }

        const { rows: imageRows } = await pool.query(
            `SELECT pi.url FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE p.store_id = $1`,
            [storeId]
        );
        const imageUrls = imageRows.map((r) => r.url);
        if (store.logo_url) imageUrls.push(store.logo_url);

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                `DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE store_id = $1)`,
                [storeId]
            );
            await client.query(
                `DELETE FROM appointments WHERE product_id IN (SELECT id FROM products WHERE store_id = $1)`,
                [storeId]
            );
            await client.query(
                `DELETE FROM cart_items WHERE product_id IN (SELECT id FROM products WHERE store_id = $1)`,
                [storeId]
            );
            await client.query(`DELETE FROM orders WHERE store_id = $1`, [storeId]); // cascadea order_items y messages
            await client.query(`DELETE FROM products WHERE store_id = $1`, [storeId]); // cascadea product_images
            await client.query(`DELETE FROM stores WHERE id = $1`, [storeId]); // cascadea business_hours/special_dates/blocked_slots/favorites/reviews
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        imageUrls.forEach((url) => storage.deleteImage(url));

        res.status(204).send();
    } catch (err) {
        console.error("admin.purgeStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { listPendingStores, listApprovedStores, approveStore, rejectStore, setActive, purgeStore };
