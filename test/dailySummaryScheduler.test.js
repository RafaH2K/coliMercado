const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, cleanup } = require("./fixtures");
const scheduler = require("../src/jobs/dailySummaryScheduler");
const dailySummaryEmail = require("../src/lib/dailySummaryEmail");

function currentHHMM(timeZone) {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(
        new Date()
    );
}

test("tick: manda el resumen por correo a un negocio Básico/Pro cuya hora configurada coincide con la actual", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const { rows: basicoPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'basico'`);
    await pool.query(
        `UPDATE stores SET plan_id = $1, timezone = 'America/Mexico_City', whatsapp_summary_time = $2 WHERE id = $3`,
        [basicoPlan[0].id, `${currentHHMM("America/Mexico_City")}:00`, storeId]
    );
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const original = dailySummaryEmail.sendDailySummaryEmail;
    let calledWith = null;
    dailySummaryEmail.sendDailySummaryEmail = async (store) => {
        calledWith = store;
    };
    t.after(() => {
        dailySummaryEmail.sendDailySummaryEmail = original;
    });

    await scheduler.tick();

    assert.equal(calledWith?.id, storeId);
    assert.ok(calledWith.owner_email, "debe incluir el correo del dueño, no un teléfono");
});

test("tick: no manda nada a un negocio Free (plan sin el perk)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    await pool.query(
        `UPDATE stores SET timezone = 'America/Mexico_City', whatsapp_summary_time = $1 WHERE id = $2`,
        [`${currentHHMM("America/Mexico_City")}:00`, storeId]
    );
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const original = dailySummaryEmail.sendDailySummaryEmail;
    let called = false;
    dailySummaryEmail.sendDailySummaryEmail = async () => {
        called = true;
    };
    t.after(() => {
        dailySummaryEmail.sendDailySummaryEmail = original;
    });

    await scheduler.tick();

    assert.equal(called, false);
});

test("tick: no manda nada si la hora configurada no coincide con la actual", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const { rows: basicoPlan } = await pool.query(`SELECT id FROM plans WHERE code = 'basico'`);
    await pool.query(
        `UPDATE stores SET plan_id = $1, timezone = 'America/Mexico_City', whatsapp_summary_time = '00:00:00' WHERE id = $2`,
        [basicoPlan[0].id, storeId]
    );
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const original = dailySummaryEmail.sendDailySummaryEmail;
    let called = false;
    dailySummaryEmail.sendDailySummaryEmail = async () => {
        called = true;
    };
    t.after(() => {
        dailySummaryEmail.sendDailySummaryEmail = original;
    });

    if (currentHHMM("America/Mexico_City") === "00:00") return; // evita el falso negativo si justo son las 00:00
    await scheduler.tick();

    assert.equal(called, false);
});

after(() => pool.end());
