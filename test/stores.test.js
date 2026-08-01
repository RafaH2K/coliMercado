const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, cleanup, mockRes } = require("./fixtures");
const stores = require("../src/controllers/stores.controller");

test("create: un negocio nuevo nace pendiente de aprobación", async (t) => {
    const userId = await createUser();
    let storeId;
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await stores.create({ user: { id: userId }, body: { name: "Negocio Nuevo" } }, res);
    storeId = res.body.id;

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.is_admin_approved, false);
});

test("update: el dueño no puede autoaprobarse mandando is_active en el body", async (t) => {
    const userId = await createUser();
    const createRes = mockRes();
    await stores.create({ user: { id: userId }, body: { name: "Negocio Intento Autoaprobar" } }, createRes);
    const storeId = createRes.body.id;
    t.after(() => cleanup({ userId, storeId }));

    const updateRes = mockRes();
    await stores.update(
        { store: { id: storeId }, body: { name: "Nuevo nombre", is_active: true, is_admin_approved: true } },
        updateRes
    );

    assert.equal(updateRes.body.name, "Nuevo nombre", "los campos permitidos sí deben actualizarse");
    const { rows } = await pool.query(`SELECT is_admin_approved FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].is_admin_approved, false, "is_admin_approved no debió cambiar vía update()");
});

test("list: un negocio pendiente no aparece en el listado público", async (t) => {
    const userId = await createUser();
    const createRes = mockRes();
    await stores.create({ user: { id: userId }, body: { name: "Negocio Oculto Del Listado" } }, createRes);
    const storeId = createRes.body.id;
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await stores.list({ query: {} }, res);
    assert.ok(!res.body.some((s) => s.id === storeId));
});

test("getById: un negocio pendiente responde 404 públicamente", async (t) => {
    const userId = await createUser();
    const createRes = mockRes();
    await stores.create({ user: { id: userId }, body: { name: "Negocio Oculto Del Detalle" } }, createRes);
    const storeId = createRes.body.id;
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await stores.getById({ params: { storeId } }, res);
    assert.equal(res.statusCode, 404);
});

test("setPlan: baja a Free y limpia la suscripción de Stripe activa", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const { rows: proPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1, stripe_subscription_id = 'sub_test_fake' WHERE id = $2`, [
        proPlan[0].id,
        storeId,
    ]);

    const stripe = require("../src/config/stripe");
    const originalCancel = stripe.subscriptions.cancel;
    let canceledId = null;
    stripe.subscriptions.cancel = async (id) => {
        canceledId = id;
        return { id };
    };
    t.after(() => {
        stripe.subscriptions.cancel = originalCancel;
    });

    const res = mockRes();
    await stores.setPlan({ store: { id: storeId }, body: { plan_code: "free" } }, res);

    assert.equal(res.body.id, storeId);
    assert.equal(canceledId, "sub_test_fake");
    const { rows } = await pool.query(`SELECT plan_id, stripe_subscription_id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].plan_id, null);
    assert.equal(rows[0].stripe_subscription_id, null);
});

test("setPlan: baja a Free y recorta el catálogo activo al tope (conserva los más viejos)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productIds = [];
    for (let i = 0; i < 7; i++) productIds.push(await createProduct(storeId)); // Pro: sin tope
    t.after(() => cleanup({ userId, storeId, productId: productIds }));

    const { rows: proPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1 WHERE id = $2`, [proPlan[0].id, storeId]);

    await stores.setPlan({ store: { id: storeId }, body: { plan_code: "free" } }, mockRes());

    const { rows } = await pool.query(
        `SELECT is_active FROM products WHERE store_id = $1 ORDER BY created_at ASC`,
        [storeId]
    );
    assert.equal(rows.filter((r) => r.is_active).length, 5, "solo deben quedar 5 activos (tope de Free)");
    assert.ok(rows.slice(0, 5).every((r) => r.is_active), "los 5 más viejos deben conservarse activos");
    assert.ok(rows.slice(5).every((r) => !r.is_active), "los más nuevos deben desactivarse");
});

test("setPlan: rechaza un plan de pago (debe ir por checkout-session)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await stores.setPlan({ store: { id: storeId }, body: { plan_code: "pro" } }, res);

    assert.equal(res.statusCode, 400);
    const { rows } = await pool.query(`SELECT plan_id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].plan_id, null, "el plan actual no debió cambiar");
});

test("setPlan: rechaza un plan_code inexistente sin tocar el plan actual", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await stores.setPlan({ store: { id: storeId }, body: { plan_code: "no_existe" } }, res);

    assert.equal(res.statusCode, 400);
    const { rows } = await pool.query(`SELECT plan_id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].plan_id, null, "el plan actual no debió cambiar");
});

after(() => pool.end());
