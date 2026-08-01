const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createService, cleanup } = require("./fixtures");
const { sendDailySummaryEmail } = require("../src/lib/dailySummaryEmail");
const email = require("../src/config/email");

function mockSendEmail() {
    const original = email.sendEmail;
    let sentWith = null;
    email.sendEmail = async (args) => {
        sentWith = args;
    };
    return {
        restore: () => {
            email.sendEmail = original;
        },
        get: () => sentWith,
    };
}

test("sendDailySummaryEmail: lista las citas de HOY en modo normal", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { duration_minutes: 30 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId, productId: serviceId }));

    await pool.query(
        `UPDATE stores SET name = 'Negocio Resumen', timezone = 'America/Mexico_City', whatsapp_summary_mode = 'mismo_dia' WHERE id = $1`,
        [storeId]
    );
    await pool.query(`UPDATE users SET name = 'Cliente Resumen' WHERE id = $1`, [customerId]);

    const startsAt = new Date(Date.now() + 60 * 60 * 1000); // dentro de la próxima hora, mismo día
    await pool.query(
        `INSERT INTO appointments (product_id, customer_id, starts_at, ends_at, status)
         VALUES ($1, $2, $3, $4, 'confirmada')`,
        [serviceId, customerId, startsAt, new Date(startsAt.getTime() + 30 * 60 * 1000)]
    );

    const mock = mockSendEmail();
    t.after(mock.restore);

    await sendDailySummaryEmail({
        id: storeId,
        name: "Negocio Resumen",
        timezone: "America/Mexico_City",
        whatsapp_summary_mode: "mismo_dia",
        owner_email: "owner@example.com",
    });

    const sent = mock.get();
    assert.ok(sent, "debió llamar a sendEmail");
    assert.equal(sent.to, "owner@example.com");
    assert.match(sent.subject, /hoy/);
    assert.match(sent.html, /Cliente Resumen/);
    assert.match(sent.html, /Test Service/);
});

test("sendDailySummaryEmail: sin citas, avisa 'Sin citas/reservaciones'", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const mock = mockSendEmail();
    t.after(mock.restore);

    await sendDailySummaryEmail({
        id: storeId,
        name: "Negocio Vacío",
        timezone: "America/Mexico_City",
        whatsapp_summary_mode: "mismo_dia",
        owner_email: "owner@example.com",
    });

    assert.match(mock.get().html, /Sin citas\/reservaciones/);
});

test("sendDailySummaryEmail: modo 'noche_anterior' manda el resumen de MAÑANA, no de hoy", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { duration_minutes: 30 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId, productId: serviceId }));

    // Cita de HOY (no debe aparecer) y cita de MAÑANA (sí debe aparecer).
    const todayAppt = new Date(Date.now() + 60 * 60 * 1000);
    const tomorrowAppt = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await pool.query(
        `INSERT INTO appointments (product_id, customer_id, starts_at, ends_at, status) VALUES ($1, $2, $3, $4, 'confirmada')`,
        [serviceId, customerId, todayAppt, new Date(todayAppt.getTime() + 30 * 60 * 1000)]
    );
    await pool.query(
        `INSERT INTO appointments (product_id, customer_id, starts_at, ends_at, status) VALUES ($1, $2, $3, $4, 'confirmada')`,
        [serviceId, customerId, tomorrowAppt, new Date(tomorrowAppt.getTime() + 30 * 60 * 1000)]
    );

    const mock = mockSendEmail();
    t.after(mock.restore);

    await sendDailySummaryEmail({
        id: storeId,
        name: "Negocio Noche Anterior",
        timezone: "America/Mexico_City",
        whatsapp_summary_mode: "noche_anterior",
        owner_email: "owner@example.com",
    });

    const sent = mock.get();
    assert.match(sent.subject, /mañana/);
});

test("sendDailySummaryEmail: no incluye citas canceladas", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { duration_minutes: 30 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId, productId: serviceId }));

    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
        `INSERT INTO appointments (product_id, customer_id, starts_at, ends_at, status) VALUES ($1, $2, $3, $4, 'cancelada')`,
        [serviceId, customerId, startsAt, new Date(startsAt.getTime() + 30 * 60 * 1000)]
    );

    const mock = mockSendEmail();
    t.after(mock.restore);

    await sendDailySummaryEmail({
        id: storeId,
        name: "Negocio Cancelada",
        timezone: "America/Mexico_City",
        whatsapp_summary_mode: "mismo_dia",
        owner_email: "owner@example.com",
    });

    assert.match(mock.get().html, /Sin citas\/reservaciones/);
});

after(() => pool.end());
