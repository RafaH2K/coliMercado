const pool = require("../config/db");
const stripe = require("../config/stripe");

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
    const { rows: planRows } = await pool.query(`SELECT id FROM plans WHERE code = $1`, [planCode]);
    if (!planRows[0]) return;
    await pool.query(`UPDATE stores SET plan_id = $1, stripe_subscription_id = $2 WHERE id = $3`, [
        planRows[0].id,
        session.subscription,
        storeId,
    ]);
}

// Un negocio con una suscripción cuyo estado ya no es activo (falló el cobro
// tras los reintentos de Stripe, o se canceló) vuelve a Free automáticamente.
async function downgradeToFree(subscriptionId) {
    await pool.query(
        `UPDATE stores SET plan_id = NULL, stripe_subscription_id = NULL WHERE stripe_subscription_id = $1`,
        [subscriptionId]
    );
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
            `SELECT stripe_customer_id, stripe_subscription_id FROM stores WHERE id = $1`,
            [req.store.id]
        );
        const store = storeRows[0];

        // Cambiar de un plan de pago a otro: se cancela la suscripción vigente
        // antes de iniciar la nueva, para no cobrar dos planes a la vez.
        // ponytail: sin prorrateo del periodo restante; si eso importa, migrar
        // a stripe.subscriptions.update() con el price nuevo en vez de cancelar+crear.
        if (store.stripe_subscription_id) {
            try {
                await stripe.subscriptions.cancel(store.stripe_subscription_id);
            } catch (err) {
                console.error("plans.createCheckoutSession: no se pudo cancelar la suscripción anterior:", err.message);
            }
        }

        let customerId = store.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({ metadata: { store_id: req.store.id } });
            customerId = customer.id;
            await pool.query(`UPDATE stores SET stripe_customer_id = $1 WHERE id = $2`, [customerId, req.store.id]);
        }

        const frontendUrl = process.env.CORS_ORIGIN;
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
            success_url: `${frontendUrl}/mi-negocio?plan_session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${frontendUrl}/mi-negocio`,
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

module.exports = {
    list,
    createCheckoutSession,
    confirmCheckoutSession,
    handleSubscriptionCheckoutCompleted,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
};
