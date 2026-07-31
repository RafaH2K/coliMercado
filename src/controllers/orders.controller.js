const pool = require("../config/db");
const stripe = require("../config/stripe");

const ITEMS_SUBQUERY = `
    COALESCE(
        (SELECT json_agg(json_build_object(
            'product_id', oi.product_id, 'name', p.name, 'quantity', oi.quantity, 'price_at_purchase', oi.price_at_purchase
         ))
         FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id),
        '[]'
    ) AS items
`;

class CheckoutError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function fetchOrdersByIds(ids) {
    if (ids.length === 0) return [];
    const { rows } = await pool.query(
        `SELECT o.*, s.name AS store_name, ${ITEMS_SUBQUERY}
         FROM orders o JOIN stores s ON s.id = o.store_id
         WHERE o.id = ANY($1)
         ORDER BY o.created_at DESC`,
        [ids]
    );
    return rows;
}

// Un pedido por cada tienda representada en el carrito (un carrito puede
// mezclar productos de varias tiendas; cada tienda ve y gestiona sus propios
// pedidos). El inventario se descuenta de forma atómica (UPDATE ... WHERE
// stock >= qty) para que dos checkouts concurrentes no sobrevendan.
// Compartido entre el pago en efectivo/persona y la confirmación de Stripe.
async function placeOrders(userId, { provider, status, stripeSessionId = null }) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const { rows: cartRows } = await client.query(
            `SELECT ci.product_id, ci.quantity, p.price, p.store_id, p.is_active
             FROM cart_items ci JOIN products p ON p.id = ci.product_id
             WHERE ci.user_id = $1`,
            [userId]
        );
        if (cartRows.length === 0) throw new CheckoutError(400, "Tu carrito está vacío");
        if (cartRows.some((item) => !item.is_active)) {
            throw new CheckoutError(409, "Un producto de tu carrito ya no está disponible");
        }

        const byStore = new Map();
        for (const item of cartRows) {
            if (!byStore.has(item.store_id)) byStore.set(item.store_id, []);
            byStore.get(item.store_id).push(item);
        }

        const createdOrders = [];
        for (const [storeId, items] of byStore) {
            let total = 0;
            for (const item of items) {
                const { rows } = await client.query(
                    `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING stock`,
                    [item.quantity, item.product_id]
                );
                if (!rows[0]) throw new CheckoutError(409, "No hay suficiente inventario para uno de los productos");
                total += Number(item.price) * item.quantity;
            }

            const { rows: orderRows } = await client.query(
                `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, $3, $4) RETURNING *`,
                [userId, storeId, total, status]
            );
            const order = orderRows[0];

            for (const item of items) {
                await client.query(
                    `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES ($1, $2, $3, $4)`,
                    [order.id, item.product_id, item.quantity, item.price]
                );
            }
            await client.query(
                `INSERT INTO payments (order_id, amount, provider, status, stripe_session_id) VALUES ($1, $2, $3, $4, $5)`,
                [order.id, total, provider, status === "pagado" ? "pagado" : "pendiente", stripeSessionId]
            );

            createdOrders.push(order);
        }

        await client.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);
        await client.query("COMMIT");
        return createdOrders;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

async function checkout(req, res) {
    try {
        const created = await placeOrders(req.user.id, { provider: "efectivo", status: "pendiente" });
        res.status(201).json(await fetchOrdersByIds(created.map((o) => o.id)));
    } catch (err) {
        if (err instanceof CheckoutError) return res.status(err.status).json({ error: err.message });
        console.error("orders.checkout error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Crea una Stripe Checkout Session a partir del carrito actual y devuelve la
// URL hospedada por Stripe a la que el frontend debe redirigir. No toca el
// carrito ni el inventario todavía: eso pasa hasta confirmStripeSession,
// cuando Stripe ya confirmó el cobro.
async function createCheckoutSession(req, res) {
    try {
        const { rows: cartRows } = await pool.query(
            `SELECT ci.product_id, ci.quantity, p.name, p.price, p.is_active
             FROM cart_items ci JOIN products p ON p.id = ci.product_id
             WHERE ci.user_id = $1`,
            [req.user.id]
        );
        if (cartRows.length === 0) return res.status(400).json({ error: "Tu carrito está vacío" });
        if (cartRows.some((item) => !item.is_active)) {
            return res.status(409).json({ error: "Un producto de tu carrito ya no está disponible" });
        }

        const frontendUrl = process.env.CORS_ORIGIN;
        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            line_items: cartRows.map((item) => ({
                quantity: item.quantity,
                price_data: {
                    currency: "mxn",
                    unit_amount: Math.round(Number(item.price) * 100),
                    product_data: { name: item.name },
                },
            })),
            metadata: { user_id: req.user.id },
            success_url: `${frontendUrl}/carrito/exito?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${frontendUrl}/carrito`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error("orders.createCheckoutSession error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// El frontend llama esto desde la página de éxito tras volver de Stripe. Se
// verifica el pago directamente contra la API de Stripe (nunca se confía en
// el estado que trae la URL) antes de generar los pedidos.
// ponytail: confirmación por polling desde el cliente en vez de un webhook;
// si el usuario cierra la pestaña antes de volver, el pedido no se crea.
// Subir a un webhook de Stripe (checkout.session.completed) si eso importa.
async function confirmStripeSession(req, res) {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: "session_id es requerido" });
    try {
        const { rows: existingPayment } = await pool.query(
            `SELECT order_id FROM payments WHERE stripe_session_id = $1`,
            [session_id]
        );
        if (existingPayment.length > 0) {
            return res.json(await fetchOrdersByIds(existingPayment.map((p) => p.order_id)));
        }

        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status !== "paid") {
            return res.status(402).json({ error: "El pago no se ha completado" });
        }
        if (session.metadata?.user_id !== req.user.id) {
            return res.status(403).json({ error: "Esta sesión de pago no te pertenece" });
        }

        const created = await placeOrders(req.user.id, {
            provider: "stripe",
            status: "pagado",
            stripeSessionId: session.id,
        });
        res.status(201).json(await fetchOrdersByIds(created.map((o) => o.id)));
    } catch (err) {
        if (err instanceof CheckoutError) {
            // El cliente ya pagó de verdad en Stripe (session.payment_status === "paid")
            // antes de llegar aquí. Si el pedido no se puede generar (ej. se agotó el
            // inventario en el intervalo entre pagar y confirmar), hay que devolver el
            // dinero: quedarnos con el cobro sin entregar nada no es aceptable.
            try {
                const failedSession = await stripe.checkout.sessions.retrieve(session_id);
                if (failedSession.payment_intent) {
                    await stripe.refunds.create({ payment_intent: failedSession.payment_intent });
                }
            } catch (refundErr) {
                console.error("orders.confirmStripeSession refund error:", refundErr.message);
            }
            return res.status(err.status).json({ error: `${err.message}. Tu pago fue reembolsado automáticamente.` });
        }
        // 23505 = unique_violation: otra petición concurrente para la misma
        // sesión (doble llamada del cliente) ya insertó el pago primero.
        if (err.code === "23505") {
            const { rows: existingPayment } = await pool.query(
                `SELECT order_id FROM payments WHERE stripe_session_id = $1`,
                [session_id]
            );
            return res.status(200).json(await fetchOrdersByIds(existingPayment.map((p) => p.order_id)));
        }
        console.error("orders.confirmStripeSession error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function listMine(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT o.*, s.name AS store_name, ${ITEMS_SUBQUERY}
             FROM orders o JOIN stores s ON s.id = o.store_id
             WHERE o.user_id = $1
             ORDER BY o.created_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error("orders.listMine error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function listForStore(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT o.*, u.name AS customer_name, u.email AS customer_email, ${ITEMS_SUBQUERY}
             FROM orders o JOIN users u ON u.id = o.user_id
             WHERE o.store_id = $1
             ORDER BY o.created_at DESC`,
            [req.store.id]
        );
        res.json(rows);
    } catch (err) {
        console.error("orders.listForStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

const STATUSES = ["pendiente", "pagado", "entregado", "cancelado"];

async function updateStatus(req, res) {
    const { status } = req.body;
    if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: `status debe ser uno de: ${STATUSES.join(", ")}` });
    }
    try {
        const { rows } = await pool.query(
            `SELECT o.id, s.owner_id FROM orders o JOIN stores s ON s.id = o.store_id WHERE o.id = $1`,
            [req.params.id]
        );
        const order = rows[0];
        if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
        if (order.owner_id !== req.user.id) {
            return res.status(403).json({ error: "No eres dueño de este pedido" });
        }
        const { rows: updated } = await pool.query(
            `UPDATE orders SET status = $1 WHERE id = $2 RETURNING *`,
            [status, req.params.id]
        );
        res.json(updated[0]);
    } catch (err) {
        console.error("orders.updateStatus error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = {
    checkout,
    createCheckoutSession,
    confirmStripeSession,
    listMine,
    listForStore,
    updateStatus,
};
