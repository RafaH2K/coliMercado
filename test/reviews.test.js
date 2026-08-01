const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, cleanup, mockRes } = require("./fixtures");
const reviews = require("../src/controllers/reviews.controller");

test("upsert: crea una reseña nueva", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const res = mockRes();
    await reviews.upsert(
        { user: { id: customerId }, params: { storeId }, body: { rating: 5, comment: "Excelente" } },
        res
    );

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.rating, 5);
    assert.equal(res.body.comment, "Excelente");
});

test("upsert: reenviar el POST actualiza la propia reseña (no crea otra)", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    await reviews.upsert(
        { user: { id: customerId }, params: { storeId }, body: { rating: 3, comment: "meh" } },
        mockRes()
    );
    const res = mockRes();
    await reviews.upsert(
        { user: { id: customerId }, params: { storeId }, body: { rating: 5, comment: "cambié de opinión" } },
        res
    );

    assert.equal(res.body.rating, 5);
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM reviews WHERE store_id = $1`, [storeId]);
    assert.equal(rows[0].count, 1, "no debe crear una segunda fila");
});

test("upsert: rating fuera de rango responde 400", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const res = mockRes();
    await reviews.upsert({ user: { id: customerId }, params: { storeId }, body: { rating: 8 } }, res);

    assert.equal(res.statusCode, 400);
});

test("upsert: negocio inexistente responde 404", async (t) => {
    const customerId = await createUser();
    t.after(() => cleanup({ userId: customerId }));

    const res = mockRes();
    await reviews.upsert(
        {
            user: { id: customerId },
            params: { storeId: "00000000-0000-0000-0000-000000000000" },
            body: { rating: 4 },
        },
        res
    );

    assert.equal(res.statusCode, 404);
});

test("listForStore: devuelve las reseñas con el nombre del cliente", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    await reviews.upsert(
        { user: { id: customerId }, params: { storeId }, body: { rating: 4, comment: "Bien" } },
        mockRes()
    );

    const res = mockRes();
    await reviews.listForStore({ params: { storeId } }, res);

    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].rating, 4);
});

after(() => pool.end());
