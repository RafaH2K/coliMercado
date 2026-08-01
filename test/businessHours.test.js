const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, cleanup, mockRes } = require("./fixtures");
const businessHours = require("../src/controllers/businessHours.controller");

test("replaceForStore: guarda el horario semanal enviado", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await businessHours.replaceForStore(
        {
            store: { id: storeId },
            body: {
                hours: [
                    { day_of_week: 1, start_time: "09:00", end_time: "18:00" },
                    { day_of_week: 2, start_time: "09:00", end_time: "18:00" },
                ],
            },
        },
        res
    );

    assert.equal(res.body.ok, true);
    assert.equal(res.body.count, 2);

    const listRes = mockRes();
    await businessHours.getForStore({ params: { storeId } }, listRes);
    assert.equal(listRes.body.length, 2);
});

test("replaceForStore: reemplaza el horario anterior por completo (no acumula)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    await businessHours.replaceForStore(
        { store: { id: storeId }, body: { hours: [{ day_of_week: 1, start_time: "09:00", end_time: "18:00" }] } },
        mockRes()
    );
    await businessHours.replaceForStore(
        { store: { id: storeId }, body: { hours: [{ day_of_week: 3, start_time: "10:00", end_time: "14:00" }] } },
        mockRes()
    );

    const res = mockRes();
    await businessHours.getForStore({ params: { storeId } }, res);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].day_of_week, 3);
});

test("replaceForStore: rechaza si 'hours' no es un arreglo", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await businessHours.replaceForStore({ store: { id: storeId }, body: { hours: "no-es-arreglo" } }, res);

    assert.equal(res.statusCode, 400);
});

test("replaceForStore: rechaza un day_of_week fuera de rango sin tocar lo existente", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    await businessHours.replaceForStore(
        { store: { id: storeId }, body: { hours: [{ day_of_week: 1, start_time: "09:00", end_time: "18:00" }] } },
        mockRes()
    );

    const res = mockRes();
    await businessHours.replaceForStore(
        { store: { id: storeId }, body: { hours: [{ day_of_week: 7, start_time: "09:00", end_time: "18:00" }] } },
        res
    );
    assert.equal(res.statusCode, 400);

    const check = mockRes();
    await businessHours.getForStore({ params: { storeId } }, check);
    assert.equal(check.body.length, 1, "el horario previo no debió borrarse por un intento inválido");
});

test("replaceForStore: rechaza un horario sin start_time/end_time", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await businessHours.replaceForStore({ store: { id: storeId }, body: { hours: [{ day_of_week: 1 }] } }, res);

    assert.equal(res.statusCode, 400);
});

test("getForStore: negocio sin horario configurado devuelve arreglo vacío", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await businessHours.getForStore({ params: { storeId } }, res);

    assert.deepEqual(res.body, []);
});

after(() => pool.end());
