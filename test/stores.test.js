const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, cleanup, mockRes } = require("./fixtures");
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

test("setPlan: asigna el plan_id correspondiente al code recibido", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await stores.setPlan({ store: { id: storeId }, body: { plan_code: "pro" } }, res);

    assert.equal(res.body.id, storeId);
    const { rows } = await pool.query(
        `SELECT pl.code FROM stores s JOIN plans pl ON pl.id = s.plan_id WHERE s.id = $1`,
        [storeId]
    );
    assert.equal(rows[0].code, "pro");
});

test("setPlan: rechaza un plan_code inexistente sin tocar el plan actual", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    await stores.setPlan({ store: { id: storeId }, body: { plan_code: "basico" } }, mockRes());
    const res = mockRes();
    await stores.setPlan({ store: { id: storeId }, body: { plan_code: "no_existe" } }, res);

    assert.equal(res.statusCode, 400);
    const { rows } = await pool.query(
        `SELECT pl.code FROM stores s JOIN plans pl ON pl.id = s.plan_id WHERE s.id = $1`,
        [storeId]
    );
    assert.equal(rows[0].code, "basico", "el plan actual no debió cambiar");
});

after(() => pool.end());
