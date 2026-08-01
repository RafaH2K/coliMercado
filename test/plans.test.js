const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, cleanup, mockRes } = require("./fixtures");
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

test("createCheckoutSession: cancela la suscripción anterior antes de iniciar el cambio de plan", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    await pool.query(
        `UPDATE stores SET stripe_customer_id = 'cus_test', stripe_subscription_id = 'sub_test_anterior' WHERE id = $1`,
        [storeId]
    );
    t.after(() => cleanup({ userId, storeId }));

    const originalCreate = stripe.checkout.sessions.create;
    const originalCancel = stripe.subscriptions.cancel;
    let canceledId = null;
    stripe.checkout.sessions.create = async () => ({ url: "https://checkout.stripe.test/fake" });
    stripe.subscriptions.cancel = async (id) => {
        canceledId = id;
        return { id };
    };
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
        stripe.subscriptions.cancel = originalCancel;
    });

    const res = mockRes();
    await plans.createCheckoutSession({ store: { id: storeId }, body: { plan_code: "basico" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(canceledId, "sub_test_anterior");
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

after(() => pool.end());
