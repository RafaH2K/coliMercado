const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, cleanup, mockRes } = require("./fixtures");
const orders = require("../src/controllers/orders.controller");
const stripe = require("../src/config/stripe");

test("checkout: compra exitosa descuenta stock, crea el pedido y vacía el carrito", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { price: 50, stock: 3 });
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 2)`, [userId, productId]);
    t.after(() => cleanup({ userId, storeId, productId }));

    const res = mockRes();
    await orders.checkout({ user: { id: userId } }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].total_amount, "100.00");
    assert.equal(res.body[0].status, "pendiente");

    const { rows: stockRows } = await pool.query(`SELECT stock FROM products WHERE id = $1`, [productId]);
    assert.equal(stockRows[0].stock, 1);

    const { rows: cartRows } = await pool.query(`SELECT * FROM cart_items WHERE user_id = $1`, [userId]);
    assert.equal(cartRows.length, 0);
});

test("checkout: sin inventario suficiente hace rollback completo (no toca stock ni pedidos)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { price: 50, stock: 1 });
    // se inserta directo, saltando la validación de cart.add, para simular
    // una carrera real: el stock bajó después de que el item ya estaba en el carrito.
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 2)`, [userId, productId]);
    t.after(() => cleanup({ userId, storeId, productId }));

    const res = mockRes();
    await orders.checkout({ user: { id: userId } }, res);

    assert.equal(res.statusCode, 409);

    const { rows: stockRows } = await pool.query(`SELECT stock FROM products WHERE id = $1`, [productId]);
    assert.equal(stockRows[0].stock, 1, "el stock no debió descontarse");

    const { rows: orderRows } = await pool.query(`SELECT * FROM orders WHERE user_id = $1`, [userId]);
    assert.equal(orderRows.length, 0, "no debió crearse ningún pedido");

    const { rows: cartRows } = await pool.query(`SELECT * FROM cart_items WHERE user_id = $1`, [userId]);
    assert.equal(cartRows.length, 1, "el carrito debió conservarse intacto");
});

test("checkout: carrito vacío responde 400", async (t) => {
    const userId = await createUser();
    t.after(() => cleanup({ userId }));

    const res = mockRes();
    await orders.checkout({ user: { id: userId } }, res);

    assert.equal(res.statusCode, 400);
});

test("createCheckoutSession: cobra el precio con el recargo del 12% por tarjeta", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { price: 100, stock: 5 });
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 2)`, [userId, productId]);
    t.after(() => cleanup({ userId, storeId, productId }));

    const originalCreate = stripe.checkout.sessions.create;
    let sessionArgs = null;
    stripe.checkout.sessions.create = async (args) => {
        sessionArgs = args;
        return { url: "https://checkout.stripe.test/fake" };
    };
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
    });

    const res = mockRes();
    await orders.createCheckoutSession({ user: { id: userId } }, res);

    assert.equal(res.body.url, "https://checkout.stripe.test/fake");
    assert.equal(sessionArgs.line_items[0].price_data.unit_amount, 11200, "$100 + 12% = $112.00 -> 11200 centavos");
    assert.equal(sessionArgs.line_items[0].quantity, 2);
});

test("confirmStripeSession: pago ya pagado con inventario agotado se reembolsa automáticamente", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { price: 200, stock: 0 });
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)`, [userId, productId]);

    const originalRetrieve = stripe.checkout.sessions.retrieve;
    const originalRefundsCreate = stripe.refunds.create;
    let refundedWith = null;
    stripe.checkout.sessions.retrieve = async () => ({
        payment_status: "paid",
        payment_intent: "pi_test_fake",
        metadata: { user_id: userId },
    });
    stripe.refunds.create = async (args) => {
        refundedWith = args;
        return { id: "re_test_fake" };
    };
    t.after(async () => {
        stripe.checkout.sessions.retrieve = originalRetrieve;
        stripe.refunds.create = originalRefundsCreate;
        await cleanup({ userId, storeId, productId });
    });

    const res = mockRes();
    await orders.confirmStripeSession({ user: { id: userId }, body: { session_id: "cs_test_fake" } }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /reembolsado/);
    assert.deepEqual(refundedWith, { payment_intent: "pi_test_fake" });

    const { rows: orderRows } = await pool.query(`SELECT * FROM orders WHERE user_id = $1`, [userId]);
    assert.equal(orderRows.length, 0, "no debió crearse un pedido pese al cobro");
});

test("confirmStripeSession: una sesión ya procesada es idempotente (no duplica el pedido)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { price: 75, stock: 5 });
    t.after(() => cleanup({ userId, storeId, productId }));

    const { rows: orderRows } = await pool.query(
        `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, 75, 'pagado') RETURNING id`,
        [userId, storeId]
    );
    const orderId = orderRows[0].id;
    await pool.query(
        `INSERT INTO payments (order_id, amount, provider, status, stripe_session_id) VALUES ($1, 75, 'stripe', 'pagado', 'cs_test_ya_procesada')`,
        [orderId]
    );

    const res = mockRes();
    await orders.confirmStripeSession(
        { user: { id: userId }, body: { session_id: "cs_test_ya_procesada" } },
        res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, orderId);

    const { rows: allOrders } = await pool.query(`SELECT * FROM orders WHERE user_id = $1`, [userId]);
    assert.equal(allOrders.length, 1, "no debió crearse un segundo pedido");
});

after(() => pool.end());
