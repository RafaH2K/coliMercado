const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, createService, cleanup, mockRes } = require("./fixtures");
const requireAdmin = require("../src/middlewares/admin");
const requireStoreOwner = require("../src/middlewares/storeOwner");
const requireProductOwner = require("../src/middlewares/productOwner");
const requireServiceOwner = require("../src/middlewares/serviceOwner");

// ---------- requireAdmin ----------

test("requireAdmin: deja pasar a un usuario is_admin=true", async (t) => {
    const userId = await createUser({ isAdmin: true });
    t.after(() => cleanup({ userId }));

    const res = mockRes();
    let nextCalled = false;
    await requireAdmin({ user: { id: userId } }, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
});

test("requireAdmin: rechaza a un usuario normal con 403", async (t) => {
    const userId = await createUser({ isAdmin: false });
    t.after(() => cleanup({ userId }));

    const res = mockRes();
    let nextCalled = false;
    await requireAdmin({ user: { id: userId } }, res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 403);
    assert.equal(nextCalled, false);
});

// ---------- requireStoreOwner ----------

test("requireStoreOwner: adjunta req.store cuando el usuario es el dueño", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const req = { params: { storeId }, user: { id: ownerId } };
    const res = mockRes();
    let nextCalled = false;
    await requireStoreOwner(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.store.id, storeId);
});

test("requireStoreOwner: 403 si el usuario no es el dueño", async (t) => {
    const ownerId = await createUser();
    const strangerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, strangerId], storeId }));

    const res = mockRes();
    let nextCalled = false;
    await requireStoreOwner({ params: { storeId }, user: { id: strangerId } }, res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 403);
    assert.equal(nextCalled, false);
});

test("requireStoreOwner: 404 si el negocio no existe", async (t) => {
    const userId = await createUser();
    t.after(() => cleanup({ userId }));

    const res = mockRes();
    await requireStoreOwner(
        { params: { storeId: "00000000-0000-0000-0000-000000000000" }, user: { id: userId } },
        res,
        () => assert.fail("next() no debió llamarse")
    );

    assert.equal(res.statusCode, 404);
});

// ---------- requireProductOwner ----------

test("requireProductOwner: adjunta req.product cuando el usuario es el dueño", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const req = { params: { id: productId }, user: { id: ownerId } };
    const res = mockRes();
    let nextCalled = false;
    await requireProductOwner(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.product.id, productId);
});

test("requireProductOwner: 403 si el usuario no es el dueño", async (t) => {
    const ownerId = await createUser();
    const strangerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: [ownerId, strangerId], storeId, productId }));

    const res = mockRes();
    await requireProductOwner({ params: { id: productId }, user: { id: strangerId } }, res, () =>
        assert.fail("next() no debió llamarse")
    );

    assert.equal(res.statusCode, 403);
});

test("requireProductOwner: 404 para un servicio (type='service'), no es un producto", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const serviceId = await createService(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await requireProductOwner({ params: { id: serviceId }, user: { id: ownerId } }, res, () =>
        assert.fail("next() no debió llamarse")
    );

    assert.equal(res.statusCode, 404);
});

// ---------- requireServiceOwner ----------

test("requireServiceOwner: adjunta req.service cuando el usuario es el dueño", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const serviceId = await createService(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const req = { params: { id: serviceId }, user: { id: ownerId } };
    const res = mockRes();
    let nextCalled = false;
    await requireServiceOwner(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.service.id, serviceId);
});

test("requireServiceOwner: 404 para un producto (type='product'), no es un servicio", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await requireServiceOwner({ params: { id: productId }, user: { id: ownerId } }, res, () =>
        assert.fail("next() no debió llamarse")
    );

    assert.equal(res.statusCode, 404);
});

after(() => pool.end());
