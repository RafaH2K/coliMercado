const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createService, cleanup, mockRes } = require("./fixtures");
const appointments = require("../src/controllers/appointments.controller");
const stripe = require("../src/config/stripe");

async function makeStorePro(storeId) {
    const { rows } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1 WHERE id = $2`, [rows[0].id, storeId]);
}

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

test("create: servicio con anticipo en negocio Pro inicia el cobro en vez de confirmar directo", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    await makeStorePro(storeId);
    const serviceId = await createService(storeId, { duration_minutes: 30, deposit_amount: 100 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

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
    await appointments.create(
        { user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } },
        res
    );

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.requires_payment, true);
    assert.equal(res.body.checkout_url, "https://checkout.stripe.test/fake");
    assert.equal(sessionArgs.metadata.kind, "appointment_deposit");
    assert.equal(sessionArgs.line_items[0].price_data.unit_amount, 10000);

    const { rows } = await pool.query(`SELECT status, hold_expires_at, deposit_amount FROM appointments WHERE id = $1`, [
        res.body.appointment_id,
    ]);
    assert.equal(rows[0].status, "pendiente_pago");
    assert.ok(rows[0].hold_expires_at, "debe tener un hold_expires_at");
    assert.equal(rows[0].deposit_amount, "100.00");
});

test("create: servicio con anticipo por debajo del mínimo de Stripe ($10 MXN) responde error y libera el hold", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    await makeStorePro(storeId);
    // deposit_amount=5 viene directo de fixtures (bypasa la validación del
    // controller) para simular datos de antes de ese fix.
    const serviceId = await createService(storeId, { duration_minutes: 30, deposit_amount: 5 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const originalCreate = stripe.checkout.sessions.create;
    let called = false;
    stripe.checkout.sessions.create = async () => {
        called = true;
        return { url: "https://checkout.stripe.test/fake" };
    };
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
    });

    const res = mockRes();
    await appointments.create(
        { user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } },
        res
    );

    assert.equal(res.statusCode, 500);
    assert.equal(called, false, "no debió ni intentar llamar a Stripe");
    const { rows } = await pool.query(`SELECT status FROM appointments WHERE product_id = $1`, [serviceId]);
    assert.equal(rows.length, 0, "el hold pendiente_pago debió liberarse");
});

test("create: servicio con anticipo en negocio SIN Pro ignora el anticipo (reserva directa)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { duration_minutes: 30, deposit_amount: 100 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const res = mockRes();
    await appointments.create(
        { user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } },
        res
    );

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.status, "pendiente");
    assert.equal(res.body.requires_payment, undefined);
});

test("create: un hold 'pendiente_pago' vigente bloquea el horario (capacity=1)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    await makeStorePro(storeId);
    const serviceId = await createService(storeId, { duration_minutes: 30, capacity: 1, deposit_amount: 50 });
    const customerId = await createUser();
    const rivalId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId, rivalId], storeId }));

    const originalCreate = stripe.checkout.sessions.create;
    stripe.checkout.sessions.create = async () => ({ url: "https://checkout.stripe.test/fake" });
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
    });

    const starts_at = inHours(24);
    const first = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at } }, first);
    assert.equal(first.statusCode, 201);

    const second = mockRes();
    await appointments.create({ user: { id: rivalId }, body: { product_id: serviceId, starts_at } }, second);
    assert.equal(second.statusCode, 409, "el hold sin pagar todavía debe seguir bloqueando el horario");
});

test("create: un hold 'pendiente_pago' YA EXPIRADO no bloquea el horario", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    await makeStorePro(storeId);
    const serviceId = await createService(storeId, { duration_minutes: 30, capacity: 1, deposit_amount: 50 });
    const customerId = await createUser();
    const rivalId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId, rivalId], storeId }));

    const originalCreate = stripe.checkout.sessions.create;
    stripe.checkout.sessions.create = async () => ({ url: "https://checkout.stripe.test/fake" });
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
    });

    const starts_at = inHours(24);
    const first = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at } }, first);
    await pool.query(`UPDATE appointments SET hold_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
        first.body.appointment_id,
    ]);

    const second = mockRes();
    await appointments.create({ user: { id: rivalId }, body: { product_id: serviceId, starts_at } }, second);
    assert.equal(second.statusCode, 201, "el hold expirado ya no debe contar contra la capacidad");
});

test("activateDeposit: confirma el hold, guarda el payment_intent, y es idempotente", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    await makeStorePro(storeId);
    const serviceId = await createService(storeId, { duration_minutes: 30, deposit_amount: 100 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const originalCreate = stripe.checkout.sessions.create;
    stripe.checkout.sessions.create = async () => ({ url: "https://checkout.stripe.test/fake" });
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
    });

    const created = mockRes();
    await appointments.create(
        { user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } },
        created
    );
    const appointmentId = created.body.appointment_id;

    const session = { payment_intent: "pi_test_deposito", metadata: { appointment_id: appointmentId } };
    await appointments.activateDeposit(session);

    const { rows } = await pool.query(
        `SELECT status, hold_expires_at, stripe_payment_intent_id FROM appointments WHERE id = $1`,
        [appointmentId]
    );
    assert.equal(rows[0].status, "pendiente");
    assert.equal(rows[0].hold_expires_at, null);
    assert.equal(rows[0].stripe_payment_intent_id, "pi_test_deposito");

    // segunda vez (ej. webhook Y confirm llegan ambos): no debe romper ni duplicar.
    await appointments.activateDeposit(session);
    const { rows: again } = await pool.query(`SELECT status FROM appointments WHERE id = $1`, [appointmentId]);
    assert.equal(again[0].status, "pendiente");
});

test("activateDeposit: hold expirado y horario ya tomado por otro -> reembolsa y cancela", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    await makeStorePro(storeId);
    const serviceId = await createService(storeId, { duration_minutes: 30, capacity: 1, deposit_amount: 50 });
    const customerId = await createUser();
    const rivalId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId, rivalId], storeId }));

    const originalCreate = stripe.checkout.sessions.create;
    const originalRefund = stripe.refunds.create;
    stripe.checkout.sessions.create = async () => ({ url: "https://checkout.stripe.test/fake" });
    let refundedWith = null;
    stripe.refunds.create = async (args) => {
        refundedWith = args;
        return { id: "re_test_fake" };
    };
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
        stripe.refunds.create = originalRefund;
    });

    const starts_at = inHours(24);
    const held = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at } }, held);
    const appointmentId = held.body.appointment_id;
    await pool.query(`UPDATE appointments SET hold_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
        appointmentId,
    ]);

    // el rival toma el horario directo (sin anticipo, ya expiró el hold del primero)
    const rivalRes = mockRes();
    await appointments.create({ user: { id: rivalId }, body: { product_id: serviceId, starts_at } }, rivalRes);
    assert.equal(rivalRes.statusCode, 201);

    // el pago tardío del primero llega después: ya no hay lugar
    await appointments.activateDeposit({
        payment_intent: "pi_test_tarde",
        metadata: { appointment_id: appointmentId },
    });

    const { rows } = await pool.query(`SELECT status FROM appointments WHERE id = $1`, [appointmentId]);
    assert.equal(rows[0].status, "cancelada");
    assert.deepEqual(refundedWith, { payment_intent: "pi_test_tarde" });
});

test("updateStatus: cancelar una cita con anticipo pagado reembolsa automáticamente", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId);
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const created = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } }, created);
    const apptId = created.body.id;
    await pool.query(`UPDATE appointments SET stripe_payment_intent_id = 'pi_test_pagado' WHERE id = $1`, [apptId]);

    const originalRefund = stripe.refunds.create;
    let refundedWith = null;
    stripe.refunds.create = async (args) => {
        refundedWith = args;
        return { id: "re_test_fake" };
    };
    t.after(() => {
        stripe.refunds.create = originalRefund;
    });

    const res = mockRes();
    await appointments.updateStatus({ user: { id: customerId }, params: { id: apptId }, body: { status: "cancelada" } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(refundedWith, { payment_intent: "pi_test_pagado" });
});

test("updateStatus: cancelar una cita completada no reembolsa (el ciclo de vida no retrocede)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId);
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const created = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } }, created);
    const apptId = created.body.id;
    await pool.query(
        `UPDATE appointments SET status = 'completada', stripe_payment_intent_id = 'pi_test_ya_completada' WHERE id = $1`,
        [apptId]
    );

    let refundCalled = false;
    const originalRefund = stripe.refunds.create;
    stripe.refunds.create = async () => {
        refundCalled = true;
        return { id: "re_test_fake" };
    };
    t.after(() => {
        stripe.refunds.create = originalRefund;
    });

    const res = mockRes();
    await appointments.updateStatus({ user: { id: ownerId }, params: { id: apptId }, body: { status: "cancelada" } }, res);

    assert.equal(res.statusCode, 409);
    assert.equal(refundCalled, false, "no debió reembolsar una cita ya completada");
});

test("updateStatus: una cita cancelada no puede reactivarse (evita doble reserva del mismo horario)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId);
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const created = mockRes();
    await appointments.create({ user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } }, created);
    const apptId = created.body.id;
    await pool.query(`UPDATE appointments SET status = 'cancelada' WHERE id = $1`, [apptId]);

    const res = mockRes();
    await appointments.updateStatus({ user: { id: ownerId }, params: { id: apptId }, body: { status: "confirmada" } }, res);

    assert.equal(res.statusCode, 409);
});

test("listMine/listForStore: nunca muestran holds 'pendiente_pago'", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    await makeStorePro(storeId);
    const serviceId = await createService(storeId, { duration_minutes: 30, deposit_amount: 100 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId }));

    const originalCreate = stripe.checkout.sessions.create;
    stripe.checkout.sessions.create = async () => ({ url: "https://checkout.stripe.test/fake" });
    t.after(() => {
        stripe.checkout.sessions.create = originalCreate;
    });

    const created = mockRes();
    await appointments.create(
        { user: { id: customerId }, body: { product_id: serviceId, starts_at: inHours(24) } },
        created
    );

    const mineRes = mockRes();
    await appointments.listMine({ user: { id: customerId } }, mineRes);
    assert.equal(mineRes.body.length, 0);

    const storeRes = mockRes();
    await appointments.listForStore({ store: { id: storeId } }, storeRes);
    assert.equal(storeRes.body.length, 0);
});

after(() => pool.end());
