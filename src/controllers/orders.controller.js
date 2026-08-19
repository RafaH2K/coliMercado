const pool = require("../config/db");
const stripe = require("../config/stripe");
const mercadopago = require("../lib/mercadopago");
const { decrypt } = require("../lib/crypto");
const { sendEmail } = require("../config/email");
const { frontendUrl, backendUrl } = require("../lib/frontendUrl");
const plans = require("./plans.controller");

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

// Recargo solo en el pago con tarjeta (Mercado Pago): cubre la comisión de
// la plataforma. El negocio siempre recibe exactamente su precio de lista
// -- la diferencia entre lo que paga el cliente y ese precio de lista se
// declara como marketplace_fee al crear la preferencia, y Mercado Pago la
// separa automáticamente hacia la cuenta de la plataforma.
const MERCADOPAGO_CARD_SURCHARGE = 1.12;

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
// Compartido entre el pago en efectivo/persona y la confirmación de Mercado
// Pago. storeId acota el carrito a un solo negocio (un pago de Mercado Pago
// solo puede ir a UNA cuenta conectada, ver createMercadoPagoCheckoutSession)
// -- si se omite, se procesa el carrito completo (pago en persona).
async function placeOrders(userId, { provider, status, mercadopagoPaymentId = null }, storeId = null) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const { rows: cartRows } = await client.query(
            `SELECT ci.product_id, ci.quantity, p.price, p.store_id, p.is_active
             FROM cart_items ci JOIN products p ON p.id = ci.product_id
             WHERE ci.user_id = $1 AND ($2::uuid IS NULL OR p.store_id = $2)`,
            [userId, storeId]
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
        for (const [orderStoreId, items] of byStore) {
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
                [userId, orderStoreId, total, status]
            );
            const order = orderRows[0];

            for (const item of items) {
                await client.query(
                    `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES ($1, $2, $3, $4)`,
                    [order.id, item.product_id, item.quantity, item.price]
                );
            }
            await client.query(
                `INSERT INTO payments (order_id, amount, provider, status, mercadopago_payment_id) VALUES ($1, $2, $3, $4, $5)`,
                [order.id, total, provider, status === "pagado" ? "pagado" : "pendiente", mercadopagoPaymentId]
            );

            createdOrders.push(order);
        }

        await client.query(
            `DELETE FROM cart_items WHERE user_id = $1 AND product_id IN (SELECT id FROM products WHERE store_id = ANY($2::uuid[]))`,
            [userId, [...byStore.keys()]]
        );
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

// Crea una preferencia de pago (Checkout Pro) de Mercado Pago para los
// items del carrito de UN solo negocio -- una preferencia solo puede
// cobrar a nombre de UNA cuenta de Mercado Pago, así que un carrito con
// productos de varias tiendas se paga con un botón por tienda (ver
// Cart.tsx). No toca el carrito ni el inventario todavía: eso pasa hasta
// confirmMercadoPagoPayment, cuando el pago ya está aprobado.
async function createMercadoPagoCheckoutSession(req, res) {
    const { store_id } = req.body;
    if (!store_id) return res.status(400).json({ error: "store_id es requerido" });
    try {
        const { rows: storeRows } = await pool.query(`SELECT mercadopago_access_token FROM stores WHERE id = $1`, [
            store_id,
        ]);
        const encryptedToken = storeRows[0]?.mercadopago_access_token;
        if (!encryptedToken) {
            return res
                .status(400)
                .json({ error: "Este negocio no ha conectado Mercado Pago; paga en persona o elige otro negocio" });
        }

        const { rows: cartRows } = await pool.query(
            `SELECT ci.product_id, ci.quantity, p.name, p.price, p.is_active
             FROM cart_items ci JOIN products p ON p.id = ci.product_id
             WHERE ci.user_id = $1 AND p.store_id = $2`,
            [req.user.id, store_id]
        );
        if (cartRows.length === 0) {
            return res.status(400).json({ error: "No tienes productos de este negocio en tu carrito" });
        }
        if (cartRows.some((item) => !item.is_active)) {
            return res.status(409).json({ error: "Un producto de tu carrito ya no está disponible" });
        }

        const items = cartRows.map((item) => ({
            title: item.name,
            quantity: item.quantity,
            unit_price: Number((Number(item.price) * MERCADOPAGO_CARD_SURCHARGE).toFixed(2)),
            currency_id: "MXN",
        }));
        const listedTotal = cartRows.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
        const chargedTotal = items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0);
        // El negocio recibe exactamente su precio de lista (listedTotal); lo
        // que se le cobró de más al cliente por el recargo es la comisión de
        // la plataforma. Se calcula sobre los montos YA redondeados a 2
        // decimales (no sobre listedTotal * 0.12) para que la cuenta cuadre
        // centavo a centavo con lo que Mercado Pago realmente va a cobrar.
        const marketplaceFee = Number((chargedTotal - listedTotal).toFixed(2));

        const frontend = frontendUrl();
        const preference = await mercadopago.createPreference({
            accessToken: decrypt(encryptedToken),
            items,
            marketplaceFee,
            backUrls: {
                success: `${frontend}/carrito/exito`,
                failure: `${frontend}/carrito`,
                pending: `${frontend}/carrito`,
            },
            notificationUrl: `${backendUrl()}/api/mercadopago/webhook`,
            externalReference: `order:${req.user.id}:${store_id}`,
        });
        res.json({ url: preference.init_point });
    } catch (err) {
        console.error("orders.createMercadoPagoCheckoutSession error:", err.message);
        res.status(500).json({ error: "No se pudo iniciar el cobro con Mercado Pago" });
    }
}

// Núcleo compartido entre la confirmación que dispara el navegador (rápida,
// pero se pierde si el cliente cierra la pestaña antes de volver) y el
// webhook de Mercado Pago (más lento, pero siempre llega) -- mismo patrón
// dual que ya usaba Stripe. `payment` ya viene consultado por el llamador
// (con el access_token que haya podido usar cada uno para obtenerlo);
// aquí solo se usa su resultado, y el token del negocio se vuelve a
// necesitar únicamente si hay que reembolsar.
async function fulfillMercadoPagoPayment({ payment, userId, storeId }) {
    const paymentId = String(payment.id);
    const { rows: existingPayment } = await pool.query(
        `SELECT order_id FROM payments WHERE mercadopago_payment_id = $1`,
        [paymentId]
    );
    if (existingPayment.length > 0) {
        return { orders: await fetchOrdersByIds(existingPayment.map((p) => p.order_id)), created: false };
    }
    if (payment.status !== "approved") {
        throw new CheckoutError(402, "El pago no se ha completado");
    }

    try {
        const created = await placeOrders(
            userId,
            { provider: "mercadopago", status: "pagado", mercadopagoPaymentId: paymentId },
            storeId
        );
        return { orders: await fetchOrdersByIds(created.map((o) => o.id)), created: true };
    } catch (err) {
        // 23505 = unique_violation: otra llamada concurrente (el navegador y
        // el webhook casi al mismo tiempo) ya insertó el pago primero.
        if (err.code === "23505") {
            const { rows: existing } = await pool.query(
                `SELECT order_id FROM payments WHERE mercadopago_payment_id = $1`,
                [paymentId]
            );
            return { orders: await fetchOrdersByIds(existing.map((p) => p.order_id)), created: false };
        }
        if (err instanceof CheckoutError) {
            // Ya se cobró de verdad en Mercado Pago (payment.status ===
            // "approved"). Si el pedido no se puede generar (ej. se agotó el
            // inventario en el intervalo entre pagar y confirmar), hay que
            // devolver el dinero -- quedarnos con el cobro sin entregar nada
            // no es aceptable (mismo criterio que el flujo de Stripe de antes).
            try {
                const { rows: storeRows } = await pool.query(
                    `SELECT mercadopago_access_token FROM stores WHERE id = $1`,
                    [storeId]
                );
                const encryptedToken = storeRows[0]?.mercadopago_access_token;
                if (encryptedToken) {
                    await mercadopago.refundPayment({ accessToken: decrypt(encryptedToken), paymentId });
                }
            } catch (refundErr) {
                console.error("orders.fulfillMercadoPagoPayment refund error:", refundErr.message);
            }
            err.message = `${err.message}. Tu pago fue reembolsado automáticamente.`;
        }
        throw err;
    }
}

// El frontend llama esto desde la página de éxito tras volver de Mercado
// Pago, para mostrar el pedido al instante. El webhook (ver
// mercadopago.controller.js#webhook) es la vía confiable que igual genera
// el pedido si el cliente nunca vuelve.
async function confirmMercadoPagoPayment(req, res) {
    const { payment_id, external_reference } = req.body;
    if (!payment_id || !external_reference) {
        return res.status(400).json({ error: "payment_id y external_reference son requeridos" });
    }
    const [kind, userId, storeId] = String(external_reference).split(":");
    if (kind !== "order") {
        return res.status(400).json({ error: "Referencia de pago inválida" });
    }
    if (userId !== req.user.id) {
        return res.status(403).json({ error: "Este pago no te pertenece" });
    }
    try {
        // Se usa el access_token de la propia plataforma para consultar el
        // pago (la app que medió el OAuth puede ver los pagos que facilitó);
        // el token del negocio solo se vuelve a necesitar para un reembolso.
        const payment = await mercadopago.getPayment({
            accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
            paymentId: payment_id,
        });
        const { orders, created } = await fulfillMercadoPagoPayment({ payment, userId, storeId });
        res.status(created ? 201 : 200).json(orders);
    } catch (err) {
        if (err instanceof CheckoutError) return res.status(err.status).json({ error: err.message });
        console.error("orders.confirmMercadoPagoPayment error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Único checkout que sigue en Stripe: alta de suscripción de plan (ver
// plans.controller.js). Carrito y anticipo de citas ahora van por Mercado
// Pago (ver mercadopago.controller.js#webhook).
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
            if (session.mode === "subscription") {
                await plans.handleSubscriptionCheckoutCompleted(session);
            }
        } else if (event.type === "customer.subscription.updated") {
            await plans.handleSubscriptionUpdated(event.data.object);
        } else if (event.type === "customer.subscription.deleted") {
            await plans.handleSubscriptionDeleted(event.data.object);
        }
    } catch (err) {
        // Ya se hizo lo posible; solo se deja registro. Si Stripe no recibe
        // 2xx, reintentará el webhook.
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

// El ciclo de vida de un pedido solo avanza, nunca retrocede: "pagado" (por
// Mercado Pago o porque el dueño cobró en efectivo) no debe poder
// regresarse a "pendiente" -- entre otras cosas porque StatsPanel.tsx
// cuenta como ingreso todo lo que esté en pagado/entregado, y retroceder el
// estado le haría desaparecer ingresos ya reales de las estadísticas del
// negocio. "entregado" y "cancelado" son terminales.
const ALLOWED_TRANSITIONS = {
    pendiente: ["pagado", "cancelado"],
    pagado: ["entregado", "cancelado"],
    entregado: [],
    cancelado: [],
};

async function updateStatus(req, res) {
    const { status } = req.body;
    if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: `status debe ser uno de: ${STATUSES.join(", ")}` });
    }
    try {
        const { rows } = await pool.query(
            `SELECT o.id, o.status, o.store_id, s.owner_id FROM orders o JOIN stores s ON s.id = o.store_id WHERE o.id = $1`,
            [req.params.id]
        );
        const order = rows[0];
        if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
        if (order.owner_id !== req.user.id) {
            return res.status(403).json({ error: "No eres dueño de este pedido" });
        }
        // Repetir el estado actual es un no-op válido (evita un 409 confuso
        // ante un doble clic o un reintento de red); cualquier otro cambio
        // debe seguir el ciclo de vida de arriba.
        if (status !== order.status && !ALLOWED_TRANSITIONS[order.status].includes(status)) {
            return res.status(409).json({
                error: `No se puede cambiar un pedido de "${order.status}" a "${status}"`,
            });
        }
        const { rows: updated } = await pool.query(
            `UPDATE orders SET status = $1 WHERE id = $2 RETURNING *`,
            [status, req.params.id]
        );

        // Un pedido pagado con tarjeta que se cancela debe devolver el cobro.
        // provider decide con qué API reembolsar: 'stripe' cubre pedidos
        // pagados antes de este cambio (Mercado Pago reemplazó a Stripe para
        // pedidos nuevos, pero los viejos ya cobrados por Stripe siguen
        // necesitando poder reembolsarse). Los pedidos en efectivo nunca
        // pasaron por ninguna pasarela, no hay nada que reembolsar ahí.
        if (status === "cancelado" && order.status === "pagado") {
            const { rows: paymentRows } = await pool.query(
                `SELECT provider, stripe_session_id, mercadopago_payment_id FROM payments WHERE order_id = $1`,
                [req.params.id]
            );
            const payment = paymentRows[0];
            if (payment?.provider === "stripe" && payment.stripe_session_id) {
                try {
                    const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
                    if (session.payment_intent) {
                        await stripe.refunds.create({ payment_intent: session.payment_intent });
                    }
                } catch (err) {
                    console.error("orders.updateStatus: fallo el reembolso del pedido (Stripe):", err.message);
                }
            } else if (payment?.provider === "mercadopago" && payment.mercadopago_payment_id) {
                try {
                    const { rows: storeRows } = await pool.query(
                        `SELECT mercadopago_access_token FROM stores WHERE id = $1`,
                        [order.store_id]
                    );
                    const encryptedToken = storeRows[0]?.mercadopago_access_token;
                    if (encryptedToken) {
                        await mercadopago.refundPayment({
                            accessToken: decrypt(encryptedToken),
                            paymentId: payment.mercadopago_payment_id,
                        });
                    }
                } catch (err) {
                    console.error("orders.updateStatus: fallo el reembolso del pedido (Mercado Pago):", err.message);
                }
            }
        }

        res.json(updated[0]);
    } catch (err) {
        console.error("orders.updateStatus error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = {
    checkout,
    createMercadoPagoCheckoutSession,
    confirmMercadoPagoPayment,
    fulfillMercadoPagoPayment,
    handleStripeWebhook,
    listMine,
    listForStore,
    updateStatus,
};
