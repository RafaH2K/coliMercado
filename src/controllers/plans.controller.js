const pool = require("../config/db");
const stripe = require("../config/stripe");
const { frontendUrl } = require("../lib/frontendUrl");
const { trimToLimit } = require("../middlewares/planLimit");

async function list(req, res) {
    try {
        const { rows } = await pool.query(`SELECT * FROM plans ORDER BY price_mxn ASC`);
        res.json(rows);
    } catch (err) {
        console.error("plans.list error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Activa (o reactiva) el plan de un negocio a partir de una sesión de Stripe
// ya pagada. Es un UPDATE puro (a diferencia de crear un pedido), así que
// aplicarlo dos veces con la misma sesión no duplica nada: idempotente por
// diseño, no hace falta la deduplicación que sí necesita orders.controller.js.
async function activateSubscription(session) {
    const storeId = session.metadata?.store_id;
    const planCode = session.metadata?.plan_code;
    if (!storeId || !planCode) return;
    const { rows: planRows } = await pool.query(`SELECT id, max_products FROM plans WHERE code = $1`, [planCode]);
    const plan = planRows[0];
    if (!plan) return;

    // CTE + UPDATE en un solo statement: leer el valor viejo y escribir el
    // nuevo queda atómico (el lock de fila de Postgres serializa dos
    // llamadas concurrentes), así que si el webhook y la confirmación del
    // navegador procesan la misma sesión casi a la vez, la segunda ve el
    // subscription_id que la primera acaba de escribir como "el anterior" —
    // no intenta cancelar la misma suscripción dos veces.
    const { rows: updatedRows } = await pool.query(
        `WITH previous AS (SELECT stripe_subscription_id FROM stores WHERE id = $3)
         UPDATE stores SET plan_id = $1, stripe_subscription_id = $2
         WHERE id = $3
         RETURNING (SELECT stripe_subscription_id FROM previous) AS previous_subscription_id`,
        [plan.id, session.subscription, storeId]
    );
    const previousSubscriptionId = updatedRows[0]?.previous_subscription_id;

    // Cambiar a un plan de pago más limitado (ej. Pro -> Básico) también puede
    // dejar el catálogo activo por encima del nuevo tope.
    await trimToLimit(storeId, plan.max_products);

    // Si venía de otro plan de pago, esa suscripción vieja se cancela HASTA
    // AHORA (con la nueva ya activa) — no antes de crear el checkout, para
    // no dejar una ventana donde el negocio se ve "sin plan": ese hueco
    // dispararía customer.subscription.deleted y downgradeToFree recortaría
    // el catálogo a Free de paso, aunque el dueño esté subiendo de plan.
    // ponytail: sin prorrateo del tiempo no usado del plan anterior.
    if (previousSubscriptionId && previousSubscriptionId !== session.subscription) {
        try {
            await stripe.subscriptions.cancel(previousSubscriptionId);
        } catch (err) {
            console.error("plans.activateSubscription: no se pudo cancelar la suscripción anterior:", err.message);
        }
    }
}

// Un negocio con una suscripción cuyo estado ya no es activo (falló el cobro
// tras los reintentos de Stripe, se canceló, o llegó el fin del periodo tras
// una cancelación programada) vuelve a Free automáticamente, y recorta el
// catálogo activo si excede el tope de Free.
async function downgradeToFree(subscriptionId) {
    const { rows } = await pool.query(
        `UPDATE stores SET plan_id = NULL, stripe_subscription_id = NULL
         WHERE stripe_subscription_id = $1 RETURNING id`,
        [subscriptionId]
    );
    const storeId = rows[0]?.id;
    if (!storeId) return;
    const { rows: freePlan } = await pool.query(`SELECT max_products FROM plans WHERE code = 'free'`);
    await trimToLimit(storeId, freePlan[0]?.max_products);
}

// Llamado desde el webhook de Stripe (fuente de verdad).
async function handleSubscriptionCheckoutCompleted(session) {
    await activateSubscription(session);
}

async function handleSubscriptionUpdated(subscription) {
    if (subscription.status === "active" || subscription.status === "trialing") return;
    await downgradeToFree(subscription.id);
}

async function handleSubscriptionDeleted(subscription) {
    await downgradeToFree(subscription.id);
}

// Inicia el cobro recurrente de un plan de pago. El plan Free no pasa por
// aquí (no hay nada que cobrar): ver stores.controller.js#setPlan para bajar
// a Free, que cancela la suscripción activa si la hay.
async function createCheckoutSession(req, res) {
    const { plan_code } = req.body;
    if (typeof plan_code !== "string") {
        return res.status(400).json({ error: "plan_code es requerido" });
    }
    try {
        const { rows: planRows } = await pool.query(`SELECT * FROM plans WHERE code = $1`, [plan_code]);
        const plan = planRows[0];
        if (!plan) return res.status(400).json({ error: "Plan inválido" });
        if (!(Number(plan.price_mxn) > 0)) {
            return res.status(400).json({ error: "El plan Free no requiere pago" });
        }

        const { rows: storeRows } = await pool.query(
            `SELECT stripe_customer_id FROM stores WHERE id = $1`,
            [req.store.id]
        );
        const store = storeRows[0];

        // La suscripción anterior (si cambia de un plan de pago a otro) se
        // cancela hasta que la nueva quede activa (ver activateSubscription),
        // no aquí: cancelarla antes dejaría al negocio momentáneamente "sin
        // plan" mientras completa el pago.
        let customerId = store.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({ metadata: { store_id: req.store.id } });
            customerId = customer.id;
            await pool.query(`UPDATE stores SET stripe_customer_id = $1 WHERE id = $2`, [customerId, req.store.id]);
        }

        const frontend = frontendUrl();
        const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: "mxn",
                        unit_amount: Math.round(Number(plan.price_mxn) * 100),
                        recurring: { interval: "month" },
                        product_data: { name: `Plan ${plan.name} - colimaMerrcado` },
                    },
                },
            ],
            metadata: { store_id: req.store.id, plan_code },
            subscription_data: { metadata: { store_id: req.store.id, plan_code } },
            success_url: `${frontend}/mi-negocio?plan_session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${frontend}/mi-negocio`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error("plans.createCheckoutSession error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// El frontend llama esto al volver de Stripe para activar el plan al
// instante; el webhook (fuente confiable) lo hace de todos modos si el
// dueño nunca vuelve.
async function confirmCheckoutSession(req, res) {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: "session_id es requerido" });
    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.metadata?.store_id !== req.store.id) {
            return res.status(403).json({ error: "Esta sesión de pago no pertenece a este negocio" });
        }
        if (session.status !== "complete") {
            return res.status(402).json({ error: "El pago no se ha completado" });
        }
        await activateSubscription(session);
        const { rows } = await pool.query(`SELECT * FROM stores WHERE id = $1`, [req.store.id]);
        res.json(rows[0]);
    } catch (err) {
        console.error("plans.confirmCheckoutSession error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Cancela AL FIN DEL PERIODO ya pagado: el negocio conserva su plan (y su
// límite) hasta esa fecha. Stripe hace la cuenta regresiva por su cuenta —
// nada que agendar de nuestro lado: cuando llegue el corte, Stripe manda
// customer.subscription.deleted y el webhook baja el negocio a Free (ver
// downgradeToFree, que ahí sí recorta el catálogo al tope de Free).
async function cancelSubscription(req, res) {
    try {
        const { rows } = await pool.query(`SELECT stripe_subscription_id FROM stores WHERE id = $1`, [req.store.id]);
        const subscriptionId = rows[0]?.stripe_subscription_id;
        if (!subscriptionId) return res.status(400).json({ error: "No tienes una suscripción activa" });

        const subscription = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
        res.json({
            cancel_at_period_end: subscription.cancel_at_period_end,
            cancel_at: subscription.cancel_at,
        });
    } catch (err) {
        console.error("plans.cancelSubscription error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Revierte una cancelación programada (todavía no llegó el fin del periodo).
async function resumeSubscription(req, res) {
    try {
        const { rows } = await pool.query(`SELECT stripe_subscription_id FROM stores WHERE id = $1`, [req.store.id]);
        const subscriptionId = rows[0]?.stripe_subscription_id;
        if (!subscriptionId) return res.status(400).json({ error: "No tienes una suscripción activa" });

        const subscription = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
        res.json({
            cancel_at_period_end: subscription.cancel_at_period_end,
            cancel_at: subscription.cancel_at,
        });
    } catch (err) {
        console.error("plans.resumeSubscription error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Estado en vivo desde Stripe (no se duplica en la BD): si no hay
// suscripción activa, subscribed:false y el frontend simplemente no muestra
// el botón de cancelar/reactivar.
async function getSubscriptionStatus(req, res) {
    try {
        const { rows } = await pool.query(`SELECT stripe_subscription_id FROM stores WHERE id = $1`, [req.store.id]);
        const subscriptionId = rows[0]?.stripe_subscription_id;
        if (!subscriptionId) return res.json({ subscribed: false });

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        res.json({
            subscribed: true,
            status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            cancel_at: subscription.cancel_at,
        });
    } catch (err) {
        console.error("plans.getSubscriptionStatus error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = {
    list,
    createCheckoutSession,
    confirmCheckoutSession,
    cancelSubscription,
    resumeSubscription,
    getSubscriptionStatus,
    handleSubscriptionCheckoutCompleted,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
};
