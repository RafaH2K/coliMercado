const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, cleanup, mockRes } = require("./fixtures");
const favorites = require("../src/controllers/favorites.controller");

test("add: agrega un negocio a favoritos", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const res = mockRes();
    await favorites.add({ user: { id: customerId }, body: { store_id: storeId } }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.store_id, storeId);
});

test("add: sin store_id responde 400", async (t) => {
    const customerId = await createUser();
    t.after(() => cleanup({ userId: customerId }));

    const res = mockRes();
    await favorites.add({ user: { id: customerId }, body: {} }, res);

    assert.equal(res.statusCode, 400);
});

test("add: negocio inexistente responde 404 (violación de FK)", async (t) => {
    const customerId = await createUser();
    t.after(() => cleanup({ userId: customerId }));

    const res = mockRes();
    await favorites.add(
        { user: { id: customerId }, body: { store_id: "00000000-0000-0000-0000-000000000000" } },
        res
    );

    assert.equal(res.statusCode, 404);
});

test("add: agregar el mismo negocio dos veces no falla (ON CONFLICT DO NOTHING)", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    await favorites.add({ user: { id: customerId }, body: { store_id: storeId } }, mockRes());
    const res = mockRes();
    await favorites.add({ user: { id: customerId }, body: { store_id: storeId } }, res);

    assert.equal(res.statusCode, 201);
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM favorites WHERE user_id = $1`, [
        customerId,
    ]);
    assert.equal(rows[0].count, 1, "no debe duplicarse la fila");
});

test("listMine: devuelve los negocios marcados como favoritos", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    await favorites.add({ user: { id: customerId }, body: { store_id: storeId } }, mockRes());

    const res = mockRes();
    await favorites.listMine({ user: { id: customerId } }, res);

    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, storeId);
});

test("remove: quita un favorito existente", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    await favorites.add({ user: { id: customerId }, body: { store_id: storeId } }, mockRes());

    const res = mockRes();
    await favorites.remove({ user: { id: customerId }, params: { storeId } }, res);
    assert.equal(res.statusCode, 204);

    const { rows } = await pool.query(`SELECT * FROM favorites WHERE user_id = $1`, [customerId]);
    assert.equal(rows.length, 0);
});

test("remove: quitar un favorito que no existe no falla (204 igual)", async (t) => {
    const customerId = await createUser();
    t.after(() => cleanup({ userId: customerId }));

    const res = mockRes();
    await favorites.remove(
        { user: { id: customerId }, params: { storeId: "00000000-0000-0000-0000-000000000000" } },
        res
    );

    assert.equal(res.statusCode, 204);
});

after(() => pool.end());
