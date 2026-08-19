const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, cleanup, mockRes } = require("./fixtures");
const orders = require("../src/controllers/orders.controller");
const stripe = require("../src/config/stripe");
const mercadopago = require("../src/lib/mercadopago");
const { encrypt } = require("../src/lib/crypto");

// Simula que el negocio ya conectó su cuenta de Mercado Pago (OAuth) --
// el token real no importa en tests, nunca se manda de verdad porque
// mercadopago.createPreference/getPayment/refundPayment se mockean.
async function connectMercadoPago(storeId) {
    await pool.query(`UPDATE stores SET mercadopago_access_token = $1, mercadopago_user_id = 123 WHERE id = $2`, [
        encrypt("fake-access-token"),
        storeId,
    ]);
}

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

test("createMercadoPagoCheckoutSession: negocio sin conectar responde 400 sin llamar a Mercado Pago", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { price: 100, stock: 5 });
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)`, [userId, productId]);
    t.after(() => cleanup({ userId, storeId, productId }));

    let called = false;
    const original = mercadopago.createPreference;
    mercadopago.createPreference = async () => {
        called = true;
        return { init_point: "https://mp.test/fake" };
    };
    t.after(() => {
        mercadopago.createPreference = original;
    });

    const res = mockRes();
    await orders.createMercadoPagoCheckoutSession({ user: { id: userId }, body: { store_id: storeId } }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(called, false, "no debió ni intentar llamar a Mercado Pago");
});

test("createMercadoPagoCheckoutSession: cobra el precio con el recargo del 12% y el negocio recibe su precio de lista", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { price: 100, stock: 5 });
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 2)`, [userId, productId]);
    await connectMercadoPago(storeId);
    t.after(() => cleanup({ userId, storeId, productId }));

    const original = mercadopago.createPreference;
    let preferenceArgs = null;
    mercadopago.createPreference = async (args) => {
        preferenceArgs = args;
        return { init_point: "https://mp.test/fake" };
    };
    t.after(() => {
        mercadopago.createPreference = original;
    });

    const res = mockRes();
    await orders.createMercadoPagoCheckoutSession({ user: { id: userId }, body: { store_id: storeId } }, res);

    assert.equal(res.body.url, "https://mp.test/fake");
    assert.equal(preferenceArgs.items[0].unit_price, 112, "$100 + 12% = $112");
    assert.equal(preferenceArgs.items[0].quantity, 2);
    // listedTotal = 200 (2 x $100), chargedTotal = 224 (2 x $112) -> el
    // negocio recibe los 200, la plataforma se queda con los 24 de más.
    assert.equal(preferenceArgs.marketplaceFee, 24);
    assert.equal(preferenceArgs.externalReference, `order:${userId}:${storeId}`);
});

test("confirmMercadoPagoPayment: no permite confirmar el pago de otro usuario", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await orders.confirmMercadoPagoPayment(
        { user: { id: userId }, body: { payment_id: "1", external_reference: `order:otro-usuario:${storeId}` } },
        res
    );

    assert.equal(res.statusCode, 403);
});

test("confirmMercadoPagoPayment: pago aprobado con inventario agotado se reembolsa automáticamente", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    const productId = await createProduct(storeId, { price: 200, stock: 0 });
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)`, [userId, productId]);
    await connectMercadoPago(storeId);

    const originalGetPayment = mercadopago.getPayment;
    const originalRefund = mercadopago.refundPayment;
    let refundedWith = null;
    mercadopago.getPayment = async () => ({ id: "mp_payment_fake", status: "approved" });
    mercadopago.refundPayment = async (args) => {
        refundedWith = args;
        return { id: "re_test_fake" };
    };
    t.after(async () => {
        mercadopago.getPayment = originalGetPayment;
        mercadopago.refundPayment = originalRefund;
        await cleanup({ userId, storeId, productId });
    });

    const res = mockRes();
    await orders.confirmMercadoPagoPayment(
        { user: { id: userId }, body: { payment_id: "mp_payment_fake", external_reference: `order:${userId}:${storeId}` } },
        res
    );

    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /reembolsado/);
    assert.equal(refundedWith.paymentId, "mp_payment_fake");

    const { rows: orderRows } = await pool.query(`SELECT * FROM orders WHERE user_id = $1`, [userId]);
    assert.equal(orderRows.length, 0, "no debió crearse un pedido pese al cobro");
});

test("confirmMercadoPagoPayment: un pago ya procesado es idempotente (no duplica el pedido)", async (t) => {
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
        `INSERT INTO payments (order_id, amount, provider, status, mercadopago_payment_id) VALUES ($1, 75, 'mercadopago', 'pagado', 'mp_ya_procesado')`,
        [orderId]
    );

    const original = mercadopago.getPayment;
    mercadopago.getPayment = async () => ({ id: "mp_ya_procesado", status: "approved" });
    t.after(() => {
        mercadopago.getPayment = original;
    });

    const res = mockRes();
    await orders.confirmMercadoPagoPayment(
        { user: { id: userId }, body: { payment_id: "mp_ya_procesado", external_reference: `order:${userId}:${storeId}` } },
        res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, orderId);

    const { rows: allOrders } = await pool.query(`SELECT * FROM orders WHERE user_id = $1`, [userId]);
    assert.equal(allOrders.length, 1, "no debió crearse un segundo pedido");
});

test("confirmMercadoPagoPayment: un carrito con 2 negocios distintos solo confirma el negocio pagado", async (t) => {
    const userId = await createUser();
    const storeA = await createStore(userId);
    const storeB = await createStore(userId);
    const productA = await createProduct(storeA, { price: 50, stock: 5 });
    const productB = await createProduct(storeB, { price: 30, stock: 5 });
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)`, [userId, productA]);
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)`, [userId, productB]);
    await connectMercadoPago(storeA);
    t.after(() => cleanup({ userId, storeId: [storeA, storeB], productId: [productA, productB] }));

    const original = mercadopago.getPayment;
    mercadopago.getPayment = async () => ({ id: "mp_solo_tienda_a", status: "approved" });
    t.after(() => {
        mercadopago.getPayment = original;
    });

    const res = mockRes();
    await orders.confirmMercadoPagoPayment(
        { user: { id: userId }, body: { payment_id: "mp_solo_tienda_a", external_reference: `order:${userId}:${storeA}` } },
        res
    );

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].store_id, storeA);

    // El producto de la tienda B debe seguir en el carrito -- no se tocó.
    const { rows: cartRows } = await pool.query(`SELECT product_id FROM cart_items WHERE user_id = $1`, [userId]);
    assert.equal(cartRows.length, 1);
    assert.equal(cartRows[0].product_id, productB);
});

test("updateStatus: pendiente -> pagado (cobro en efectivo) se permite", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const { rows } = await pool.query(
        `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, 100, 'pendiente') RETURNING id`,
        [customerId, storeId]
    );
    const orderId = rows[0].id;

    const res = mockRes();
    await orders.updateStatus({ user: { id: ownerId }, params: { id: orderId }, body: { status: "pagado" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "pagado");
});

test("updateStatus: pagado -> pendiente se rechaza (el ciclo de vida no retrocede)", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const { rows } = await pool.query(
        `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, 100, 'pagado') RETURNING id`,
        [customerId, storeId]
    );
    const orderId = rows[0].id;

    const res = mockRes();
    await orders.updateStatus({ user: { id: ownerId }, params: { id: orderId }, body: { status: "pendiente" } }, res);

    assert.equal(res.statusCode, 409);

    const { rows: unchanged } = await pool.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    assert.equal(unchanged[0].status, "pagado");
});

test("updateStatus: entregado y cancelado son terminales (no aceptan más cambios)", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const { rows } = await pool.query(
        `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, 100, 'entregado') RETURNING id`,
        [customerId, storeId]
    );
    const orderId = rows[0].id;

    const res = mockRes();
    await orders.updateStatus({ user: { id: ownerId }, params: { id: orderId }, body: { status: "cancelado" } }, res);

    assert.equal(res.statusCode, 409);
});

test("updateStatus: cancelar un pedido pagado con tarjeta reembolsa automáticamente", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const { rows } = await pool.query(
        `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, 100, 'pagado') RETURNING id`,
        [customerId, storeId]
    );
    const orderId = rows[0].id;
    await pool.query(
        `INSERT INTO payments (order_id, amount, provider, status, stripe_session_id) VALUES ($1, 100, 'stripe', 'pagado', 'cs_test_pedido_pagado')`,
        [orderId]
    );

    const originalRetrieve = stripe.checkout.sessions.retrieve;
    const originalRefundsCreate = stripe.refunds.create;
    let refundedWith = null;
    stripe.checkout.sessions.retrieve = async () => ({ payment_intent: "pi_test_pedido" });
    stripe.refunds.create = async (args) => {
        refundedWith = args;
        return { id: "re_test_fake" };
    };
    t.after(() => {
        stripe.checkout.sessions.retrieve = originalRetrieve;
        stripe.refunds.create = originalRefundsCreate;
    });

    const res = mockRes();
    await orders.updateStatus({ user: { id: ownerId }, params: { id: orderId }, body: { status: "cancelado" } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(refundedWith, { payment_intent: "pi_test_pedido" });
});

test("updateStatus: cancelar un pedido pagado por Mercado Pago reembolsa con el token del negocio", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    await connectMercadoPago(storeId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const { rows } = await pool.query(
        `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, 100, 'pagado') RETURNING id`,
        [customerId, storeId]
    );
    const orderId = rows[0].id;
    await pool.query(
        `INSERT INTO payments (order_id, amount, provider, status, mercadopago_payment_id) VALUES ($1, 100, 'mercadopago', 'pagado', 'mp_test_pedido_pagado')`,
        [orderId]
    );

    const original = mercadopago.refundPayment;
    let refundedWith = null;
    mercadopago.refundPayment = async (args) => {
        refundedWith = args;
        return { id: "re_test_fake" };
    };
    t.after(() => {
        mercadopago.refundPayment = original;
    });

    const res = mockRes();
    await orders.updateStatus({ user: { id: ownerId }, params: { id: orderId }, body: { status: "cancelado" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(refundedWith.paymentId, "mp_test_pedido_pagado");
});

test("updateStatus: cancelar un pedido pagado en efectivo no intenta reembolsar por Stripe", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const { rows } = await pool.query(
        `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, 100, 'pagado') RETURNING id`,
        [customerId, storeId]
    );
    const orderId = rows[0].id;
    await pool.query(
        `INSERT INTO payments (order_id, amount, provider, status) VALUES ($1, 100, 'efectivo', 'pagado')`,
        [orderId]
    );

    let refundCalled = false;
    const originalRefundsCreate = stripe.refunds.create;
    stripe.refunds.create = async () => {
        refundCalled = true;
        return { id: "re_test_fake" };
    };
    t.after(() => {
        stripe.refunds.create = originalRefundsCreate;
    });

    const res = mockRes();
    await orders.updateStatus({ user: { id: ownerId }, params: { id: orderId }, body: { status: "cancelado" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(refundCalled, false, "un pedido en efectivo nunca pasó por Stripe, no hay nada que reembolsar ahí");
});

test("updateStatus: repetir el estado actual es un no-op válido", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const { rows } = await pool.query(
        `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, 100, 'pagado') RETURNING id`,
        [customerId, storeId]
    );
    const orderId = rows[0].id;

    const res = mockRes();
    await orders.updateStatus({ user: { id: ownerId }, params: { id: orderId }, body: { status: "pagado" } }, res);

    assert.equal(res.statusCode, 200);
});

after(() => pool.end());
