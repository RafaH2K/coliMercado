const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, cleanup, mockRes } = require("./fixtures");
const plans = require("../src/controllers/plans.controller");
const stripe = require("../src/config/stripe");

test("createCheckoutSession: crea una sesión de suscripción y reutiliza el customer existente", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    await pool.query(`UPDATE stores SET stripe_customer_id = 'cus_test_existente' WHERE id = $1`, [storeId]);
    t.after(() => cleanup({ userId, storeId }));

    const originalCreate = stripe.checkout.sessions.create;
    const originalCustomerCreate = stripe.customers.create;
    let sessionArgs = null;
    let customerCreated = false;
    stripe.checkout.sessions.create = async (args) => {
        sessionArgs = args;
        return { url: "https://checkout.stripe.test/fake" };
    };
    stripe.customers.create = async () => {
        customerCreated = true;
        return { id: "cus_no_deberia_usarse" };
    };
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
        stripe.customers.create = originalCustomerCreate;
    });

    const res = mockRes();
    await plans.createCheckoutSession({ store: { id: storeId }, body: { plan_code: "pro" } }, res);

    assert.equal(res.body.url, "https://checkout.stripe.test/fake");
    assert.equal(customerCreated, false, "no debió crear un customer nuevo, ya había uno guardado");
    assert.equal(sessionArgs.customer, "cus_test_existente");
    assert.equal(sessionArgs.mode, "subscription");
    assert.equal(sessionArgs.metadata.store_id, storeId);
    assert.equal(sessionArgs.metadata.plan_code, "pro");
});

test("createCheckoutSession: rechaza el plan Free (no hay nada que cobrar)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await plans.createCheckoutSession({ store: { id: storeId }, body: { plan_code: "free" } }, res);

    assert.equal(res.statusCode, 400);
});

test("createCheckoutSession: NO cancela la suscripción anterior (evita el hueco 'sin plan' mientras se paga)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    await pool.query(
        `UPDATE stores SET stripe_customer_id = 'cus_test', stripe_subscription_id = 'sub_test_anterior' WHERE id = $1`,
        [storeId]
    );
    t.after(() => cleanup({ userId, storeId }));

    const originalCreate = stripe.checkout.sessions.create;
    const originalCancel = stripe.subscriptions.cancel;
    let cancelCalled = false;
    stripe.checkout.sessions.create = async () => ({ url: "https://checkout.stripe.test/fake" });
    stripe.subscriptions.cancel = async (id) => {
        cancelCalled = true;
        return { id };
    };
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
        stripe.subscriptions.cancel = originalCancel;
    });

    const res = mockRes();
    await plans.createCheckoutSession({ store: { id: storeId }, body: { plan_code: "basico" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(cancelCalled, false, "la suscripción vieja debe seguir activa hasta que la nueva se confirme");

    const { rows } = await pool.query(`SELECT stripe_subscription_id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].stripe_subscription_id, "sub_test_anterior", "no debe tocarse hasta activateSubscription");
});

test("handleSubscriptionCheckoutCompleted: activa el plan del negocio al confirmarse el pago", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    await plans.handleSubscriptionCheckoutCompleted({
        subscription: "sub_test_nuevo",
        metadata: { store_id: storeId, plan_code: "basico" },
    });

    const { rows } = await pool.query(
        `SELECT pl.code, s.stripe_subscription_id FROM stores s JOIN plans pl ON pl.id = s.plan_id WHERE s.id = $1`,
        [storeId]
    );
    assert.equal(rows[0].code, "basico");
    assert.equal(rows[0].stripe_subscription_id, "sub_test_nuevo");
});

test("handleSubscriptionCheckoutCompleted: al cambiar de plan, cancela la suscripción vieja DESPUÉS de activar la nueva (no antes)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const { rows: proPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1, stripe_subscription_id = 'sub_test_viejo' WHERE id = $2`, [
        proPlan[0].id,
        storeId,
    ]);
    t.after(() => cleanup({ userId, storeId }));

    const originalCancel = stripe.subscriptions.cancel;
    let canceledId = null;
    stripe.subscriptions.cancel = async (id) => {
        canceledId = id;
        return { id };
    };
    t.after(() => {
        stripe.subscriptions.cancel = originalCancel;
    });

    await plans.handleSubscriptionCheckoutCompleted({
        subscription: "sub_test_nuevo",
        metadata: { store_id: storeId, plan_code: "basico" },
    });

    assert.equal(canceledId, "sub_test_viejo", "debe cancelar la vieja, no la recién activada");

    const { rows } = await pool.query(
        `SELECT pl.code, s.stripe_subscription_id FROM stores s JOIN plans pl ON pl.id = s.plan_id WHERE s.id = $1`,
        [storeId]
    );
    assert.equal(rows[0].code, "basico", "el plan nuevo debe quedar activo, no verse afectado por la cancelación");
    assert.equal(rows[0].stripe_subscription_id, "sub_test_nuevo");
});

test("handleSubscriptionUpdated: pago fallido/estado no activo degrada el negocio a Free", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const { rows: proPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1, stripe_subscription_id = 'sub_test_moroso' WHERE id = $2`, [
        proPlan[0].id,
        storeId,
    ]);

    await plans.handleSubscriptionUpdated({ id: "sub_test_moroso", status: "unpaid" });

    const { rows } = await pool.query(`SELECT plan_id, stripe_subscription_id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].plan_id, null);
    assert.equal(rows[0].stripe_subscription_id, null);
});

test("handleSubscriptionUpdated: un estado activo no toca el plan", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const { rows: proPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1, stripe_subscription_id = 'sub_test_activo' WHERE id = $2`, [
        proPlan[0].id,
        storeId,
    ]);

    await plans.handleSubscriptionUpdated({ id: "sub_test_activo", status: "active" });

    const { rows } = await pool.query(`SELECT plan_id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].plan_id, proPlan[0].id);
});

test("handleSubscriptionDeleted: la cancelación en Stripe degrada el negocio a Free", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const { rows: proPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1, stripe_subscription_id = 'sub_test_cancelada' WHERE id = $2`, [
        proPlan[0].id,
        storeId,
    ]);

    await plans.handleSubscriptionDeleted({ id: "sub_test_cancelada" });

    const { rows } = await pool.query(`SELECT plan_id, stripe_subscription_id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].plan_id, null);
    assert.equal(rows[0].stripe_subscription_id, null);
});

test("handleSubscriptionDeleted: recorta el catálogo activo al tope de Free (conserva los más viejos)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productIds = [];
    for (let i = 0; i < 7; i++) productIds.push(await createProduct(storeId)); // Pro: sin tope
    t.after(() => cleanup({ userId, storeId, productId: productIds }));

    const { rows: proPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1, stripe_subscription_id = 'sub_test_recorte' WHERE id = $2`, [
        proPlan[0].id,
        storeId,
    ]);

    await plans.handleSubscriptionDeleted({ id: "sub_test_recorte" });

    const { rows } = await pool.query(
        `SELECT is_active FROM products WHERE store_id = $1 ORDER BY created_at ASC`,
        [storeId]
    );
    assert.equal(rows.filter((r) => r.is_active).length, 5, "solo deben quedar 5 activos (tope de Free)");
    assert.ok(rows.slice(0, 5).every((r) => r.is_active), "los 5 más viejos deben conservarse activos");
    assert.ok(rows.slice(5).every((r) => !r.is_active), "los más nuevos deben desactivarse");
});

test("cancelSubscription: programa cancel_at_period_end sin bajar el plan de inmediato", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    await pool.query(`UPDATE stores SET stripe_subscription_id = 'sub_test_cancelar' WHERE id = $1`, [storeId]);
    t.after(() => cleanup({ userId, storeId }));

    const originalUpdate = stripe.subscriptions.update;
    let updateArgs = null;
    stripe.subscriptions.update = async (id, args) => {
        updateArgs = { id, ...args };
        return { cancel_at_period_end: true, cancel_at: 1234567890 };
    };
    t.after(() => {
        stripe.subscriptions.update = originalUpdate;
    });

    const res = mockRes();
    await plans.cancelSubscription({ store: { id: storeId } }, res);

    assert.equal(updateArgs.id, "sub_test_cancelar");
    assert.equal(updateArgs.cancel_at_period_end, true);
    assert.equal(res.body.cancel_at_period_end, true);
    assert.equal(res.body.cancel_at, 1234567890);
});

test("cancelSubscription: sin suscripción activa responde 400", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await plans.cancelSubscription({ store: { id: storeId } }, res);

    assert.equal(res.statusCode, 400);
});

test("resumeSubscription: revierte cancel_at_period_end", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    await pool.query(`UPDATE stores SET stripe_subscription_id = 'sub_test_reactivar' WHERE id = $1`, [storeId]);
    t.after(() => cleanup({ userId, storeId }));

    const originalUpdate = stripe.subscriptions.update;
    let updateArgs = null;
    stripe.subscriptions.update = async (id, args) => {
        updateArgs = { id, ...args };
        return { cancel_at_period_end: false, cancel_at: 1234567890 };
    };
    t.after(() => {
        stripe.subscriptions.update = originalUpdate;
    });

    const res = mockRes();
    await plans.resumeSubscription({ store: { id: storeId } }, res);

    assert.equal(updateArgs.cancel_at_period_end, false);
    assert.equal(res.body.cancel_at_period_end, false);
});

test("getSubscriptionStatus: sin suscripción responde subscribed:false", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await plans.getSubscriptionStatus({ store: { id: storeId } }, res);

    assert.equal(res.body.subscribed, false);
});

test("getSubscriptionStatus: con suscripción devuelve el estado en vivo de Stripe", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    await pool.query(`UPDATE stores SET stripe_subscription_id = 'sub_test_estado' WHERE id = $1`, [storeId]);
    t.after(() => cleanup({ userId, storeId }));

    const originalRetrieve = stripe.subscriptions.retrieve;
    stripe.subscriptions.retrieve = async (id) => ({
        id,
        status: "active",
        cancel_at_period_end: true,
        cancel_at: 1234567890,
    });
    t.after(() => {
        stripe.subscriptions.retrieve = originalRetrieve;
    });

    const res = mockRes();
    await plans.getSubscriptionStatus({ store: { id: storeId } }, res);

    assert.equal(res.body.subscribed, true);
    assert.equal(res.body.status, "active");
    assert.equal(res.body.cancel_at_period_end, true);
});

after(() => pool.end());
