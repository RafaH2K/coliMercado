const path = require("path");
const { unlink } = require("fs/promises");
const pool = require("../config/db");
const stripe = require("../config/stripe");
const { isValidTimeZone } = require("../lib/timezone");
const { UPLOAD_DIR } = require("../config/upload");
const { trimToLimit } = require("../middlewares/planLimit");

async function create(req, res) {
    const { name, description, logo_url, timezone, city, phone } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: "El nombre del negocio es requerido" });
    }
    if (timezone && !isValidTimeZone(timezone)) {
        return res.status(400).json({ error: "timezone debe ser una zona IANA válida (ej. America/Mexico_City)" });
    }
    try {
        // Todo negocio nuevo nace pendiente de aprobación (is_admin_approved =
        // FALSE): no aparece en el mercado ni es accesible públicamente hasta
        // que un admin lo aprueba (ver admin.controller.js). El dueño sí puede
        // preparar su negocio desde el dashboard mientras tanto.
        const { rows } = await pool.query(
            `INSERT INTO stores (owner_id, name, description, logo_url, timezone, city, phone, is_admin_approved)
             VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE) RETURNING *`,
            [
                req.user.id,
                name,
                description || null,
                logo_url || null,
                timezone || "America/Mexico_City",
                city || null,
                phone || null,
            ]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("stores.create error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function mine(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM stores WHERE owner_id = $1 ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error("stores.mine error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Subconsulta reutilizada por list/getById para no repetir el promedio de rating.
const RATING_JOIN = `
    LEFT JOIN (
        SELECT store_id, AVG(rating)::float AS avg_rating, COUNT(*)::int AS review_count
        FROM reviews GROUP BY store_id
    ) r ON r.store_id = s.id
`;

const PAGE_SIZE = 24;

async function list(req, res) {
    const { q, category_id, city, page } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    try {
        const { rows } = await pool.query(
            `SELECT s.*, COALESCE(r.avg_rating, 0) AS avg_rating, COALESCE(r.review_count, 0) AS review_count
             FROM stores s
             ${RATING_JOIN}
             WHERE s.is_active = TRUE AND s.is_admin_approved = TRUE
               AND ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR s.description ILIKE '%' || $1 || '%')
               AND ($2::uuid IS NULL OR EXISTS (
                   SELECT 1 FROM products p WHERE p.store_id = s.id AND p.category_id = $2 AND p.is_active = TRUE
               ))
               AND ($3::text IS NULL OR s.city ILIKE '%' || $3 || '%')
             ORDER BY s.created_at DESC
             LIMIT $4 OFFSET $5`,
            [q || null, category_id || null, city || null, PAGE_SIZE, (pageNum - 1) * PAGE_SIZE]
        );
        res.json(rows);
    } catch (err) {
        console.error("stores.list error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function getById(req, res) {
    try {
        // Cuenta esta carga como una visita a la página del negocio (solo si
        // el negocio está aprobado/activo). Es un contador simple (sin
        // deduplicar por visitante ni desglose por fecha); si más adelante
        // hace falta una serie de tiempo, esto se sube a una tabla de eventos.
        const { rows: updated } = await pool.query(
            `UPDATE stores SET page_views = page_views + 1
             WHERE id = $1 AND is_active = TRUE AND is_admin_approved = TRUE RETURNING id`,
            [req.params.storeId]
        );
        if (!updated[0]) return res.status(404).json({ error: "Negocio no encontrado" });

        const { rows } = await pool.query(
            `SELECT s.*, COALESCE(r.avg_rating, 0) AS avg_rating, COALESCE(r.review_count, 0) AS review_count
             FROM stores s
             ${RATING_JOIN}
             WHERE s.id = $1`,
            [req.params.storeId]
        );
        res.json(rows[0]);
    } catch (err) {
        console.error("stores.getById error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Estadísticas para el dashboard del dueño: visitas a la página, citas y
// pedidos agrupados por estado (incluye ingresos de pedidos pagados/entregados).
async function getStats(req, res) {
    try {
        const storeId = req.store.id;

        const { rows: viewRows } = await pool.query(`SELECT page_views FROM stores WHERE id = $1`, [storeId]);

        const { rows: appointmentsByStatus } = await pool.query(
            `SELECT a.status, COUNT(*)::int AS count
             FROM appointments a JOIN products p ON p.id = a.product_id
             WHERE p.store_id = $1
             GROUP BY a.status`,
            [storeId]
        );

        const { rows: ordersByStatus } = await pool.query(
            `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0) AS revenue
             FROM orders
             WHERE store_id = $1
             GROUP BY status`,
            [storeId]
        );

        res.json({
            page_views: viewRows[0]?.page_views ?? 0,
            appointments_by_status: appointmentsByStatus,
            orders_by_status: ordersByStatus,
        });
    } catch (err) {
        console.error("stores.getStats error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// is_active NO es editable aquí a propósito: la aprobación es exclusiva del
// admin (ver admin.controller.js). Si el dueño pudiera tocarla, se saltaría
// la revisión con un PATCH directo.
async function update(req, res) {
    const { name, description, logo_url, timezone, city, phone } = req.body;
    if (timezone && !isValidTimeZone(timezone)) {
        return res.status(400).json({ error: "timezone debe ser una zona IANA válida (ej. America/Mexico_City)" });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE stores SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                logo_url = COALESCE($3, logo_url),
                timezone = COALESCE($4, timezone),
                city = COALESCE($5, city),
                phone = COALESCE($6, phone)
             WHERE id = $7
             RETURNING *`,
            [name, description, logo_url, timezone, city, phone, req.store.id]
        );
        res.json(rows[0]);
    } catch (err) {
        console.error("stores.update error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Solo baja a Free (gratis, nada que cobrar): cancela la suscripción de
// Stripe activa si la hay. Los planes de pago ya no se asignan aquí, van por
// plans.controller.js#createCheckoutSession (cobro real vía Stripe) — el
// webhook de Stripe es quien los activa una vez confirmado el pago.
async function setPlan(req, res) {
    const { plan_code } = req.body;
    if (typeof plan_code !== "string") {
        return res.status(400).json({ error: "plan_code es requerido" });
    }
    try {
        const { rows: planRows } = await pool.query(`SELECT id, price_mxn, max_products FROM plans WHERE code = $1`, [
            plan_code,
        ]);
        const plan = planRows[0];
        if (!plan) return res.status(400).json({ error: "Plan inválido" });
        if (Number(plan.price_mxn) > 0) {
            return res.status(400).json({ error: "Este plan requiere pago; usa /plan/checkout-session" });
        }

        const { rows: storeRows } = await pool.query(`SELECT stripe_subscription_id FROM stores WHERE id = $1`, [
            req.store.id,
        ]);
        const subscriptionId = storeRows[0]?.stripe_subscription_id;
        if (subscriptionId) {
            try {
                await stripe.subscriptions.cancel(subscriptionId);
            } catch (err) {
                console.error("stores.setPlan: no se pudo cancelar la suscripción:", err.message);
            }
        }

        // plan_id NULL es el sentinel de "Free" en todo el resto del código
        // (ver enforceProductLimit), no el id de la fila 'free' de plans.
        const { rows } = await pool.query(
            `UPDATE stores SET plan_id = NULL, stripe_subscription_id = NULL WHERE id = $1 RETURNING *`,
            [req.store.id]
        );
        await trimToLimit(req.store.id, plan.max_products);
        res.json(rows[0]);
    } catch (err) {
        console.error("stores.setPlan error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function uploadLogo(req, res) {
    const url = `/uploads/${req.file.filename}`;
    try {
        const { rows: prevRows } = await pool.query(`SELECT logo_url FROM stores WHERE id = $1`, [req.store.id]);
        const { rows } = await pool.query(`UPDATE stores SET logo_url = $1 WHERE id = $2 RETURNING *`, [
            url,
            req.store.id,
        ]);
        const oldUrl = prevRows[0]?.logo_url;
        if (oldUrl && oldUrl.startsWith("/uploads/")) {
            unlink(path.join(UPLOAD_DIR, path.basename(oldUrl))).catch(() => {});
        }
        res.json(rows[0]);
    } catch (err) {
        console.error("stores.uploadLogo error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { create, mine, list, getById, getStats, update, setPlan, uploadLogo };
