const pool = require("../config/db");
const stripe = require("../config/stripe");
const { sendEmail } = require("../config/email");
const { frontendUrl } = require("../lib/frontendUrl");
const plans = require("./plans.controller");
const appointments = require("./appointments.controller");

// No se espera (fire-and-forget): un correo que tarda o falla no debe
// retrasar ni tumbar la respuesta del pedido. Los errores solo se loggean.
async function notifyNewOrder(order) {
    try {
        const { rows } = await pool.query(
            `SELECT u.email, s.name AS store_name FROM stores s JOIN users u ON u.id = s.owner_id WHERE s.id = $1`,
            [order.store_id]
        );
        const owner = rows[0];
        if (!owner) return;
        await sendEmail({
            to: owner.email,
            subject: `Nuevo pedido en ${owner.store_name}`,
            html: `<p>Tienes un nuevo pedido por $${order.total_amount}.</p><p>Entra a tu panel de negocio para verlo y actualizarlo.</p>`,
        });
    } catch (err) {
        console.error("notifyNewOrder error:", err.message);
    }
}

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

// Recargo solo en el pago con tarjeta (Stripe): cubre la comisión de Stripe
// (~3%) y deja margen para la plataforma. Es puramente sobre lo que cobra
// Stripe — el pedido y las estadísticas del negocio (placeOrders, más abajo)
// siguen calculándose sobre products.price sin este recargo, así que al
// negocio no le cambia nada de lo que ve ni de lo que se le reporta.
const STRIPE_CARD_SURCHARGE = 1.12;

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
        for (const order of createdOrders) notifyNewOrder(order);
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

        const frontend = frontendUrl();
        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            line_items: cartRows.map((item) => ({
                quantity: item.quantity,
                price_data: {
                    currency: "mxn",
                    unit_amount: Math.round(Number(item.price) * 100 * STRIPE_CARD_SURCHARGE),
                    product_data: { name: item.name },
                },
            })),
            metadata: { user_id: req.user.id },
            success_url: `${frontend}/carrito/exito?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${frontend}/carrito`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error("orders.createCheckoutSession error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Núcleo compartido entre la confirmación que dispara el navegador (rápida,
// pero se pierde si el cliente cierra la pestaña antes de volver) y el
// webhook de Stripe (más lento, pero siempre llega). Cualquiera de los dos
// que llegue primero genera los pedidos; el otro es un no-op gracias a la
// unicidad de stripe_session_id.
async function fulfillStripeSession(session) {
    const { rows: existingPayment } = await pool.query(
        `SELECT order_id FROM payments WHERE stripe_session_id = $1`,
        [session.id]
    );
    if (existingPayment.length > 0) {
        return { orders: await fetchOrdersByIds(existingPayment.map((p) => p.order_id)), created: false };
    }
    if (session.payment_status !== "paid") {
        throw new CheckoutError(402, "El pago no se ha completado");
    }
    const userId = session.metadata?.user_id;
    if (!userId) throw new CheckoutError(400, "La sesión de pago no tiene un usuario asociado");

    try {
        const created = await placeOrders(userId, { provider: "stripe", status: "pagado", stripeSessionId: session.id });
        return { orders: await fetchOrdersByIds(created.map((o) => o.id)), created: true };
    } catch (err) {
        // 23505 = unique_violation: otra llamada concurrente (el navegador y el
        // webhook casi al mismo tiempo) ya insertó el pago primero.
        if (err.code === "23505") {
            const { rows: existing } = await pool.query(
                `SELECT order_id FROM payments WHERE stripe_session_id = $1`,
                [session.id]
            );
            return { orders: await fetchOrdersByIds(existing.map((p) => p.order_id)), created: false };
        }
        if (err instanceof CheckoutError) {
            // Ya se pagó de verdad en Stripe (session.payment_status === "paid").
            // Si el pedido no se puede generar (ej. se agotó el inventario en el
            // intervalo entre pagar y confirmar), hay que devolver el dinero:
            // quedarnos con el cobro sin entregar nada no es aceptable.
            try {
                if (session.payment_intent) {
                    await stripe.refunds.create({ payment_intent: session.payment_intent });
                }
            } catch (refundErr) {
                console.error("orders.fulfillStripeSession refund error:", refundErr.message);
            }
            err.message = `${err.message}. Tu pago fue reembolsado automáticamente.`;
        }
        throw err;
    }
}

// El frontend llama esto desde la página de éxito tras volver de Stripe, para
// mostrar el pedido al instante. El webhook (ver handleStripeWebhook) es la
// vía confiable que igual genera el pedido si el usuario nunca vuelve.
async function confirmStripeSession(req, res) {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: "session_id es requerido" });
    try {
        // Atajo barato: si ya se procesó (por este mismo endpoint antes, o por
        // el webhook mientras tanto), no hace falta ni llamar a Stripe de nuevo.
        const { rows: existingPayment } = await pool.query(
            `SELECT o.id AS order_id, o.user_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.stripe_session_id = $1`,
            [session_id]
        );
        if (existingPayment.length > 0) {
            if (existingPayment[0].user_id !== req.user.id) {
                return res.status(403).json({ error: "Esta sesión de pago no te pertenece" });
            }
            return res.status(200).json(await fetchOrdersByIds(existingPayment.map((p) => p.order_id)));
        }

        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.metadata?.user_id !== req.user.id) {
            return res.status(403).json({ error: "Esta sesión de pago no te pertenece" });
        }
        const { orders, created } = await fulfillStripeSession(session);
        res.status(created ? 201 : 200).json(orders);
    } catch (err) {
        if (err instanceof CheckoutError) return res.status(err.status).json({ error: err.message });
        console.error("orders.confirmStripeSession error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Fuente de verdad de los pagos: Stripe llama aquí server-to-server, así que
// el pedido se genera aunque el cliente nunca vuelva a /carrito/exito. Monta
// con express.raw() en app.js (antes de express.json()), Stripe firma el
// cuerpo crudo para verificar que la llamada viene realmente de Stripe.
async function handleStripeWebhook(req, res) {
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("stripe webhook: firma inválida:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            // "carrito", "alta de plan" y "anticipo de cita" comparten el mismo
            // endpoint de webhook (Stripe solo permite configurar una URL por
            // evento). El anticipo va en mode:"payment" igual que el carrito,
            // por eso se distingue por metadata.kind y no por session.mode.
            if (session.metadata?.kind === "appointment_deposit") {
                await appointments.activateDeposit(session);
            } else if (session.mode === "subscription") {
                await plans.handleSubscriptionCheckoutCompleted(session);
            } else {
                await fulfillStripeSession(session);
            }
        } else if (event.type === "customer.subscription.updated") {
            await plans.handleSubscriptionUpdated(event.data.object);
        } else if (event.type === "customer.subscription.deleted") {
            await plans.handleSubscriptionDeleted(event.data.object);
        }
    } catch (err) {
        // Ya se hizo lo posible (incl. el reembolso si aplicaba); solo se
        // deja registro. Si Stripe no recibe 2xx, reintentará el webhook.
        console.error("stripe webhook: fulfillment error:", err.message);
    }
    res.json({ received: true });
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
    handleStripeWebhook,
    listMine,
    listForStore,
    updateStatus,
};
