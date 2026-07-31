const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, createService, cleanup, mockRes } = require("./fixtures");
const orders = require("../src/controllers/orders.controller");
const appointments = require("../src/controllers/appointments.controller");
const messages = require("../src/controllers/messages.controller");

function inHours(h) {
    return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

test("chat de pedido: cliente y dueño pueden escribir y leer; un tercero no", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId, { price: 50, stock: 3 });
    const customerId = await createUser();
    const strangerId = await createUser();
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)`, [customerId, productId]);
    t.after(() => cleanup({ userId: [ownerId, customerId, strangerId], storeId, productId }));

    const checkoutRes = mockRes();
    await orders.checkout({ user: { id: customerId } }, checkoutRes);
    const orderId = checkoutRes.body[0].id;

    const fromCustomer = mockRes();
    await messages.createForOrder({ params: { id: orderId }, user: { id: customerId }, body: { body: "¿Ya va mi pedido?" } }, fromCustomer);
    assert.equal(fromCustomer.statusCode, 201);

    const fromOwner = mockRes();
    await messages.createForOrder({ params: { id: orderId }, user: { id: ownerId }, body: { body: "Sí, en camino" } }, fromOwner);
    assert.equal(fromOwner.statusCode, 201);

    const listRes = mockRes();
    await messages.listForOrder({ params: { id: orderId }, user: { id: customerId } }, listRes);
    assert.equal(listRes.body.length, 2);
    assert.equal(listRes.body[0].body, "¿Ya va mi pedido?");

    const strangerRes = mockRes();
    await messages.listForOrder({ params: { id: orderId }, user: { id: strangerId } }, strangerRes);
    assert.equal(strangerRes.statusCode, 404, "un usuario ajeno al pedido no debe ver el hilo");
});

test("chat de cita: rechaza mensaje vacío y bloquea a quien no es cliente ni dueño", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { duration_minutes: 30 });
    const customerId = await createUser();
    const strangerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId, strangerId], storeId }));

    const apptRes = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } }, apptRes);
    const appointmentId = apptRes.body.id;

    const emptyRes = mockRes();
    await messages.createForAppointment({ params: { id: appointmentId }, user: { id: customerId }, body: { body: "   " } }, emptyRes);
    assert.equal(emptyRes.statusCode, 400);

    const okRes = mockRes();
    await messages.createForAppointment({ params: { id: appointmentId }, user: { id: ownerId }, body: { body: "Confirmada tu cita" } }, okRes);
    assert.equal(okRes.statusCode, 201);

    const strangerRes = mockRes();
    await messages.createForAppointment({ params: { id: appointmentId }, user: { id: strangerId }, body: { body: "hola" } }, strangerRes);
    assert.equal(strangerRes.statusCode, 404);
});

after(() => pool.end());
