const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createService, cleanup, mockRes } = require("./fixtures");
const appointments = require("../src/controllers/appointments.controller");

function inHours(h) {
    return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

test("create: agenda una cita en un servicio de un negocio aprobado", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { duration_minutes: 30 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const res = mockRes();
    await appointments.create(
        { user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } },
        res
    );

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.customer_id, customerId);
    assert.equal(res.body.status, "pendiente");
});

test("create: rechaza citas en un servicio de un negocio pendiente de aprobación", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: false });
    const serviceId = await createService(storeId, { duration_minutes: 30 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const res = mockRes();
    await appointments.create(
        { user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } },
        res
    );

    assert.equal(res.statusCode, 404);
});

test("create: respeta la capacidad, la segunda cita en el mismo horario con capacity=1 falla", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { duration_minutes: 30, capacity: 1 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const starts_at = inHours(24);
    const first = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at } }, first);
    assert.equal(first.statusCode, 201);

    const second = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at } }, second);
    assert.equal(second.statusCode, 409);
});

test("updateStatus: el dueño puede confirmar la cita", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId);
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const created = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } }, created);
    const apptId = created.body.id;

    const res = mockRes();
    await appointments.updateStatus({ user: { id: ownerId }, params: { id: apptId }, body: { status: "confirmada" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "confirmada");
});

test("updateStatus: el cliente solo puede cancelar la suya, no confirmarla", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId);
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const created = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } }, created);
    const apptId = created.body.id;

    const confirmRes = mockRes();
    await appointments.updateStatus({ user: { id: customerId }, params: { id: apptId }, body: { status: "confirmada" } }, confirmRes);
    assert.equal(confirmRes.statusCode, 403);

    const cancelRes = mockRes();
    await appointments.updateStatus({ user: { id: customerId }, params: { id: apptId }, body: { status: "cancelada" } }, cancelRes);
    assert.equal(cancelRes.statusCode, 200);
});

test("updateStatus: un tercero ajeno no puede tocar la cita", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId);
    const customerId = await createUser();
    const strangerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId, strangerId], storeId }));

    const created = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } }, created);
    const apptId = created.body.id;

    const res = mockRes();
    await appointments.updateStatus({ user: { id: strangerId }, params: { id: apptId }, body: { status: "cancelada" } }, res);
    assert.equal(res.statusCode, 403);
});

after(() => pool.end());
