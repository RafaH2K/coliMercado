const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, createService, cleanup, mockRes } = require("./fixtures");
const products = require("../src/controllers/products.controller");

test("create: crea un producto válido", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    let productId;
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await products.create({ store: { id: storeId }, body: { name: "Playera", price: 199, stock: 10 } }, res);
    productId = res.body?.id;

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.type, "product");
    assert.equal(res.body.stock, 10);
});

test("create: rechaza nombre vacío", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await products.create({ store: { id: storeId }, body: { name: "  ", price: 100, stock: 1 } }, res);

    assert.equal(res.statusCode, 400);
});

test("create: rechaza precio <= 0", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await products.create({ store: { id: storeId }, body: { name: "Gorra", price: 0, stock: 1 } }, res);

    assert.equal(res.statusCode, 400);
});

test("create: rechaza stock negativo o no entero", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const negRes = mockRes();
    await products.create({ store: { id: storeId }, body: { name: "Gorra", price: 100, stock: -1 } }, negRes);
    assert.equal(negRes.statusCode, 400);

    const floatRes = mockRes();
    await products.create({ store: { id: storeId }, body: { name: "Gorra", price: 100, stock: 1.5 } }, floatRes);
    assert.equal(floatRes.statusCode, 400);
});

test("getById: devuelve un producto de una tienda aprobada", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await products.getById({ params: { id: productId } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.id, productId);
    assert.ok(Array.isArray(res.body.images));
});

test("getById: 404 si el producto es de una tienda pendiente de aprobación", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: false });
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await products.getById({ params: { id: productId } }, res);

    assert.equal(res.statusCode, 404);
});

test("getById: 404 para un id de tipo 'service' (no es un producto)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await products.getById({ params: { id: serviceId } }, res);

    assert.equal(res.statusCode, 404);
});

test("listForStore: solo devuelve productos activos de esa tienda", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const activeId = await createProduct(storeId);
    const inactiveId = await createProduct(storeId);
    await pool.query(`UPDATE products SET is_active = FALSE WHERE id = $1`, [inactiveId]);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: [activeId, inactiveId] }));

    const res = mockRes();
    await products.listForStore({ params: { storeId } }, res);

    const ids = res.body.map((p) => p.id);
    assert.ok(ids.includes(activeId));
    assert.ok(!ids.includes(inactiveId));
});

test("search: filtra por nombre (q) y solo trae tiendas aprobadas/activas", async (t) => {
    const ownerId = await createUser();
    const approvedStoreId = await createStore(ownerId, { approved: true });
    const pendingStoreId = await createStore(ownerId, { approved: false });
    const matchId = await createProduct(approvedStoreId);
    await pool.query(`UPDATE products SET name = 'Producto Buscable Único' WHERE id = $1`, [matchId]);
    const hiddenId = await createProduct(pendingStoreId);
    await pool.query(`UPDATE products SET name = 'Producto Buscable Único' WHERE id = $1`, [hiddenId]);
    t.after(() =>
        cleanup({ userId: ownerId, storeId: [approvedStoreId, pendingStoreId], productId: [matchId, hiddenId] })
    );

    const res = mockRes();
    await products.search({ query: { q: "Buscable Único" } }, res);

    const ids = res.body.map((p) => p.id);
    assert.ok(ids.includes(matchId));
    assert.ok(!ids.includes(hiddenId), "no debe incluir productos de tiendas pendientes de aprobación");
});

test("update: actualiza solo los campos enviados (COALESCE conserva el resto)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId, { price: 50, stock: 3 });
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await products.update({ product: { id: productId }, body: { stock: 20 } }, res);

    assert.equal(res.body.stock, 20);
    assert.equal(res.body.price, "50.00", "el precio no enviado no debió cambiar");
});

test("update: rechaza precio <= 0 sin tocar el producto", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId, { price: 50, stock: 3 });
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await products.update({ product: { id: productId }, body: { price: 0 } }, res);

    assert.equal(res.statusCode, 400);
    const { rows } = await pool.query(`SELECT price FROM products WHERE id = $1`, [productId]);
    assert.equal(rows[0].price, "50.00");
});

test("update: rechaza stock negativo", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId, { price: 50, stock: 3 });
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await products.update({ product: { id: productId }, body: { stock: -1 } }, res);

    assert.equal(res.statusCode, 400);
});

test("update: rechaza nombre vacío", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await products.update({ product: { id: productId }, body: { name: "   " } }, res);

    assert.equal(res.statusCode, 400);
});

after(() => pool.end());
