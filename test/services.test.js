const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, createService, cleanup, mockRes } = require("./fixtures");
const services = require("../src/controllers/services.controller");
const businessHours = require("../src/controllers/businessHours.controller");

async function makeStorePro(storeId) {
    const { rows } = await pool.query(`SELECT id FROM plans WHERE code = 'pro'`);
    await pool.query(`UPDATE stores SET plan_id = $1 WHERE id = $2`, [rows[0].id, storeId]);
}

test("create: crea un servicio válido", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    let serviceId;
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await services.create(
        { store: { id: storeId }, body: { name: "Corte", price: 150, duration_minutes: 30 } },
        res
    );
    serviceId = res.body?.id;

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.type, "service");
    assert.equal(res.body.capacity, 1, "capacity por default debe ser 1");
});

test("create: rechaza duration_minutes inválido", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await services.create(
        { store: { id: storeId }, body: { name: "Corte", price: 150, duration_minutes: 0 } },
        res
    );

    assert.equal(res.statusCode, 400);
});

test("create: rechaza deposit_amount negativo", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await services.create(
        { store: { id: storeId }, body: { name: "Corte", price: 150, duration_minutes: 30, deposit_amount: -10 } },
        res
    );

    assert.equal(res.statusCode, 400);
});

test("create: rechaza deposit_amount positivo pero menor al mínimo de Stripe ($10 MXN)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await services.create(
        { store: { id: storeId }, body: { name: "Corte", price: 150, duration_minutes: 30, deposit_amount: 5 } },
        res
    );

    assert.equal(res.statusCode, 400);
});

test("create: acepta deposit_amount 0 o positivo", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    let serviceId;
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await services.create(
        { store: { id: storeId }, body: { name: "Corte", price: 150, duration_minutes: 30, deposit_amount: 50 } },
        res
    );
    serviceId = res.body?.id;

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.deposit_amount, "50.00");
});

test("getById: expone deposit_amount solo si el plan del negocio lo permite", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { deposit_amount: 75 });
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const freeRes = mockRes();
    await services.getById({ params: { id: serviceId } }, freeRes);
    assert.equal(freeRes.body.deposit_amount, null, "plan Free no tiene el perk, no debe exponer el anticipo");

    await makeStorePro(storeId);

    const proRes = mockRes();
    await services.getById({ params: { id: serviceId } }, proRes);
    assert.equal(proRes.body.deposit_amount, "75.00");
});

test("getById: 404 si la tienda está pendiente de aprobación", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: false });
    const serviceId = await createService(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await services.getById({ params: { id: serviceId } }, res);

    assert.equal(res.statusCode, 404);
});

test("getById: 404 para un id de tipo 'product' (no es un servicio)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await services.getById({ params: { id: productId } }, res);

    assert.equal(res.statusCode, 404);
});

test("listForStore: solo servicios activos de esa tienda", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const activeId = await createService(storeId);
    const inactiveId = await createService(storeId);
    await pool.query(`UPDATE products SET is_active = FALSE WHERE id = $1`, [inactiveId]);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: [activeId, inactiveId] }));

    const res = mockRes();
    await services.listForStore({ params: { storeId } }, res);

    const ids = res.body.map((s) => s.id);
    assert.ok(ids.includes(activeId));
    assert.ok(!ids.includes(inactiveId));
});

test("search: filtra por category_id", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const { rows: catRows } = await pool.query(
        `INSERT INTO categories (name, kind) VALUES ('Test Cat Servicio', 'service') RETURNING id`
    );
    const categoryId = catRows[0].id;
    const matchId = await createService(storeId);
    await pool.query(`UPDATE products SET category_id = $1 WHERE id = $2`, [categoryId, matchId]);
    const otherId = await createService(storeId);
    t.after(async () => {
        await cleanup({ userId: ownerId, storeId, productId: [matchId, otherId] });
        await pool.query(`DELETE FROM categories WHERE id = $1`, [categoryId]);
    });

    const res = mockRes();
    await services.search({ query: { category_id: categoryId } }, res);

    const ids = res.body.map((s) => s.id);
    assert.ok(ids.includes(matchId));
    assert.ok(!ids.includes(otherId));
});

test("update: cambia deposit_amount de un servicio existente", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const serviceId = await createService(storeId, { deposit_amount: 20 });
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await services.update({ service: { id: serviceId }, body: { deposit_amount: 99 } }, res);

    assert.equal(res.body.deposit_amount, "99.00");
});

test("update: rechaza deposit_amount negativo", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const serviceId = await createService(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await services.update({ service: { id: serviceId }, body: { deposit_amount: -5 } }, res);

    assert.equal(res.statusCode, 400);
});

test("update: rechaza deposit_amount positivo pero menor al mínimo de Stripe ($10 MXN)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const serviceId = await createService(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await services.update({ service: { id: serviceId }, body: { deposit_amount: 3 } }, res);

    assert.equal(res.statusCode, 400);
});

test("update: rechaza duration_minutes <= 0 sin tocar el servicio", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const serviceId = await createService(storeId, { duration_minutes: 30 });
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await services.update({ service: { id: serviceId }, body: { duration_minutes: 0 } }, res);

    assert.equal(res.statusCode, 400);
    const { rows } = await pool.query(`SELECT duration_minutes FROM products WHERE id = $1`, [serviceId]);
    assert.equal(rows[0].duration_minutes, 30);
});

test("update: rechaza precio <= 0", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const serviceId = await createService(storeId, { price: 100 });
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await services.update({ service: { id: serviceId }, body: { price: -10 } }, res);

    assert.equal(res.statusCode, 400);
});

test("availability: sin horario configurado devuelve slots vacíos", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { duration_minutes: 30 });
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const res = mockRes();
    await services.availability({ params: { id: serviceId }, query: { date: tomorrow } }, res);

    assert.deepEqual(res.body.slots, []);
});

test("availability: genera slots dentro del horario configurado y respeta una cita ya reservada", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId, { duration_minutes: 30, capacity: 1 });
    const customerId = await createUser();
    t.after(() => cleanup({ userId: [ownerId, customerId], storeId, productId: serviceId }));

    await pool.query(`UPDATE stores SET timezone = 'America/Mexico_City' WHERE id = $1`, [storeId]);
    const tomorrow = new Date(Date.now() + 86400000);
    const dayOfWeek = tomorrow.getUTCDay();
    await businessHours.replaceForStore(
        { store: { id: storeId }, body: { hours: [{ day_of_week: dayOfWeek, start_time: "09:00", end_time: "11:00" }] } },
        mockRes()
    );
    const dateStr = tomorrow.toISOString().slice(0, 10);

    const before = mockRes();
    await services.availability({ params: { id: serviceId }, query: { date: dateStr } }, before);
    assert.ok(before.body.slots.length > 0, "debe haber slots dentro del horario configurado");

    const firstSlot = before.body.slots[0];
    await pool.query(
        `INSERT INTO appointments (product_id, customer_id, starts_at, ends_at, status, capacity_snapshot)
         VALUES ($1, $2, $3, $4, 'confirmada', 1)`,
        [serviceId, customerId, firstSlot.starts_at, firstSlot.ends_at]
    );

    const after_ = mockRes();
    await services.availability({ params: { id: serviceId }, query: { date: dateStr } }, after_);
    const stillThere = after_.body.slots.some((s) => s.starts_at === firstSlot.starts_at);
    assert.equal(stillThere, false, "el slot ya reservado no debe seguir disponible");
});

test("availability: fecha con formato inválido responde 400", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    const serviceId = await createService(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: serviceId }));

    const res = mockRes();
    await services.availability({ params: { id: serviceId }, query: { date: "31-08-2026" } }, res);

    assert.equal(res.statusCode, 400);
});

after(() => pool.end());
