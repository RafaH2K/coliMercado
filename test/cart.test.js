const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, cleanup, mockRes } = require("./fixtures");
const cart = require("../src/controllers/cart.controller");

test("cart.add rechaza una cantidad mayor al stock disponible", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { stock: 5 });
    t.after(() => cleanup({ userId, storeId, productId }));

    const res = mockRes();
    await cart.add({ user: { id: userId }, body: { product_id: productId, quantity: 10 } }, res);

    assert.equal(res.statusCode, 409);
    const { rows } = await pool.query(`SELECT quantity FROM cart_items WHERE user_id = $1`, [userId]);
    assert.equal(rows.length, 0, "no debió agregarse nada al carrito");
});

test("cart.add rechaza cuando lo ya existente más lo nuevo supera el stock", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { stock: 5 });
    t.after(() => cleanup({ userId, storeId, productId }));

    await cart.add({ user: { id: userId }, body: { product_id: productId, quantity: 3 } }, mockRes());
    const res = mockRes();
    await cart.add({ user: { id: userId }, body: { product_id: productId, quantity: 3 } }, res); // 3+3 > 5

    assert.equal(res.statusCode, 409);
    const { rows } = await pool.query(`SELECT quantity FROM cart_items WHERE user_id = $1`, [userId]);
    assert.equal(rows[0].quantity, 3, "la cantidad original no debió tocarse");
});

test("cart.updateQuantity rechaza una cantidad mayor al stock disponible", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { stock: 5 });
    t.after(() => cleanup({ userId, storeId, productId }));

    await cart.add({ user: { id: userId }, body: { product_id: productId, quantity: 2 } }, mockRes());
    const res = mockRes();
    await cart.updateQuantity({ user: { id: userId }, params: { productId }, body: { quantity: 9999 } }, res);

    assert.equal(res.statusCode, 409);
    const { rows } = await pool.query(`SELECT quantity FROM cart_items WHERE user_id = $1`, [userId]);
    assert.equal(rows[0].quantity, 2, "la cantidad no debió cambiar");
});

test("cart.updateQuantity con cantidad < 1 elimina el item", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { stock: 5 });
    t.after(() => cleanup({ userId, storeId, productId }));

    await cart.add({ user: { id: userId }, body: { product_id: productId, quantity: 2 } }, mockRes());
    const res = mockRes();
    await cart.updateQuantity({ user: { id: userId }, params: { productId }, body: { quantity: 0 } }, res);

    assert.equal(res.statusCode, 204);
    const { rows } = await pool.query(`SELECT * FROM cart_items WHERE user_id = $1`, [userId]);
    assert.equal(rows.length, 0);
});

test.after(() => pool.end());
