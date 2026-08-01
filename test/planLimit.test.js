const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, createService, cleanup, mockRes } = require("./fixtures");
const { enforceProductLimit, trimToLimit } = require("../src/middlewares/planLimit");

test("enforceProductLimit rechaza al llegar al tope del plan free (plan_id NULL = 5 productos)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productIds = [];
    for (let i = 0; i < 5; i++) productIds.push(await createProduct(storeId));
    t.after(() => cleanup({ userId, storeId, productId: productIds }));

    const res = mockRes();
    let nextCalled = false;
    await enforceProductLimit({ store: { id: storeId } }, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 403);
    assert.equal(nextCalled, false);
});

test("enforceProductLimit deja pasar antes de llegar al tope", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productIds = [await createProduct(storeId), await createProduct(storeId)];
    t.after(() => cleanup({ userId, storeId, productId: productIds }));

    const res = mockRes();
    let nextCalled = false;
    await enforceProductLimit({ store: { id: storeId } }, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
});

test("enforceProductLimit no limita al plan Pro (max_products NULL = ilimitado)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const { rows: proPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1 WHERE id = $2`, [proPlan[0].id, storeId]);
    const productIds = [];
    for (let i = 0; i < 6; i++) productIds.push(await createProduct(storeId));
    t.after(() => cleanup({ userId, storeId, productId: productIds }));

    const res = mockRes();
    let nextCalled = false;
    await enforceProductLimit({ store: { id: storeId } }, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
});

test("trimToLimit: desactiva los más nuevos hasta calzar en el tope, conserva los más viejos", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productIds = [
        await createProduct(storeId), // más viejo
        await createService(storeId),
        await createProduct(storeId),
        await createService(storeId), // más nuevo
    ];
    t.after(() => cleanup({ userId, storeId, productId: productIds }));

    await trimToLimit(storeId, 2);

    const { rows } = await pool.query(
        `SELECT id, is_active FROM products WHERE store_id = $1 ORDER BY created_at ASC`,
        [storeId]
    );
    assert.deepEqual(
        rows.map((r) => r.is_active),
        [true, true, false, false]
    );
});

test("trimToLimit: maxProducts null (ilimitado) no toca nada", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productIds = [await createProduct(storeId), await createProduct(storeId)];
    t.after(() => cleanup({ userId, storeId, productId: productIds }));

    await trimToLimit(storeId, null);

    const { rows } = await pool.query(`SELECT is_active FROM products WHERE store_id = $1`, [storeId]);
    assert.ok(rows.every((r) => r.is_active === true));
});

after(() => pool.end());
