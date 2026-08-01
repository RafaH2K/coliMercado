// Pruebas de integración: a diferencia del resto de la suite (que llama a
// los controllers directo, saltándose Express), estas levantan la app REAL
// (app.js, sin servidor de por medio) en un puerto efímero y le pegan por
// HTTP de verdad. Es la única cobertura que ejercita el enrutamiento y la
// cadena de middlewares (requireAuth, requireStoreOwner, requireAdmin...)
// tal como corre en producción.
const test = require("node:test");
const { after, before } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, cleanup } = require("./fixtures");
const app = require("../src/app");

let server;
let baseUrl;

before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
});

async function registerViaHttp() {
    const email = `http_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "HTTP Test", email, password: "password123" }),
    });
    const body = await res.json();
    return { token: body.token, userId: body.user.id, email };
}

test("POST /auth/register + POST /auth/login: ciclo completo vía HTTP", async (t) => {
    const { token, userId, email } = await registerViaHttp();
    t.after(() => cleanup({ userId }));

    assert.ok(token, "el registro debe devolver un token");

    const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
    });
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.ok(loginBody.token);
});

test("GET /stores/mine sin token responde 401 (requireAuth real, vía HTTP)", async (t) => {
    const res = await fetch(`${baseUrl}/stores/mine`);
    assert.equal(res.status, 401);
});

test("GET /stores/mine con token inválido responde 401", async (t) => {
    const res = await fetch(`${baseUrl}/stores/mine`, {
        headers: { Authorization: "Bearer token-inventado-y-falso" },
    });
    assert.equal(res.status, 401);
});

test("POST /stores + GET /stores/mine: el negocio creado aparece para su dueño", async (t) => {
    const { token, userId } = await registerViaHttp();
    let storeId;
    t.after(() => cleanup({ userId, storeId }));

    const createRes = await fetch(`${baseUrl}/stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: "Negocio HTTP Test" }),
    });
    assert.equal(createRes.status, 201);
    const store = await createRes.json();
    storeId = store.id;
    assert.equal(store.is_admin_approved, false);

    const mineRes = await fetch(`${baseUrl}/stores/mine`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const mine = await mineRes.json();
    assert.ok(mine.some((s) => s.id === storeId));
});

test("PATCH /stores/:id de un negocio ajeno responde 403 (requireStoreOwner real, vía HTTP)", async (t) => {
    const owner = await registerViaHttp();
    const stranger = await registerViaHttp();
    let storeId;
    t.after(() => cleanup({ userId: [owner.userId, stranger.userId], storeId }));

    const createRes = await fetch(`${baseUrl}/stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ name: "Negocio Ajeno" }),
    });
    storeId = (await createRes.json()).id;

    const patchRes = await fetch(`${baseUrl}/stores/${storeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${stranger.token}` },
        body: JSON.stringify({ name: "Hackeado" }),
    });
    assert.equal(patchRes.status, 403);
});

test("Flujo completo: crear negocio -> aprobar -> publicar producto -> verlo en el listado público", async (t) => {
    const owner = await registerViaHttp();
    let storeId;
    let productId;
    t.after(() => cleanup({ userId: owner.userId, storeId, productId }));

    const storeRes = await fetch(`${baseUrl}/stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ name: "Negocio Flujo HTTP" }),
    });
    storeId = (await storeRes.json()).id;

    // Antes de aprobar, no debe verse públicamente.
    const hiddenRes = await fetch(`${baseUrl}/stores/${storeId}`);
    assert.equal(hiddenRes.status, 404);

    // Aprobación directa (el flujo de admin real ya lo cubre admin.test.js).
    await pool.query(`UPDATE stores SET is_admin_approved = TRUE WHERE id = $1`, [storeId]);

    const productRes = await fetch(`${baseUrl}/stores/${storeId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ name: "Producto Flujo HTTP", price: 199, stock: 5 }),
    });
    assert.equal(productRes.status, 201);
    productId = (await productRes.json()).id;

    const listRes = await fetch(`${baseUrl}/products?q=Producto Flujo HTTP`);
    const list = await listRes.json();
    assert.ok(list.some((p) => p.id === productId));
});

test("Carrito + checkout en efectivo vía HTTP: descuenta stock y crea el pedido", async (t) => {
    const owner = await registerViaHttp();
    const customer = await registerViaHttp();
    let storeId;
    let productId;
    t.after(() => cleanup({ userId: [owner.userId, customer.userId], storeId, productId }));

    const storeRes = await fetch(`${baseUrl}/stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ name: "Negocio Carrito HTTP" }),
    });
    storeId = (await storeRes.json()).id;
    await pool.query(`UPDATE stores SET is_admin_approved = TRUE WHERE id = $1`, [storeId]);

    const productRes = await fetch(`${baseUrl}/stores/${storeId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ name: "Producto Carrito HTTP", price: 50, stock: 3 }),
    });
    productId = (await productRes.json()).id;

    const addRes = await fetch(`${baseUrl}/cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ product_id: productId, quantity: 2 }),
    });
    assert.equal(addRes.status, 201);

    const checkoutRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${customer.token}` },
    });
    assert.equal(checkoutRes.status, 201);
    const orders = await checkoutRes.json();
    assert.equal(orders[0].total_amount, "100.00");

    const productCheck = await fetch(`${baseUrl}/products/${productId}`);
    const productBody = await productCheck.json();
    assert.equal(productBody.stock, 1, "el stock debe quedar descontado tras el checkout real");
});

test("GET /admin/stores/pending sin ser admin responde 403 (requireAdmin real, vía HTTP)", async (t) => {
    const user = await registerViaHttp();
    t.after(() => cleanup({ userId: user.userId }));

    const res = await fetch(`${baseUrl}/admin/stores/pending`, {
        headers: { Authorization: `Bearer ${user.token}` },
    });
    assert.equal(res.status, 403);
});

test("Reserva de cita completa vía HTTP: negocio -> horario -> servicio -> disponibilidad -> reserva", async (t) => {
    const owner = await registerViaHttp();
    const customer = await registerViaHttp();
    let storeId;
    let serviceId;
    t.after(() => cleanup({ userId: [owner.userId, customer.userId], storeId, productId: serviceId }));

    const storeRes = await fetch(`${baseUrl}/stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ name: "Negocio Citas HTTP", timezone: "America/Mexico_City" }),
    });
    storeId = (await storeRes.json()).id;
    await pool.query(`UPDATE stores SET is_admin_approved = TRUE WHERE id = $1`, [storeId]);

    const serviceRes = await fetch(`${baseUrl}/stores/${storeId}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ name: "Servicio Citas HTTP", price: 120, duration_minutes: 30 }),
    });
    serviceId = (await serviceRes.json()).id;

    const tomorrow = new Date(Date.now() + 86400000);
    const dayOfWeek = tomorrow.getUTCDay();
    await fetch(`${baseUrl}/stores/${storeId}/business-hours`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ hours: [{ day_of_week: dayOfWeek, start_time: "09:00", end_time: "18:00" }] }),
    });

    const dateStr = tomorrow.toISOString().slice(0, 10);
    const availRes = await fetch(`${baseUrl}/services/${serviceId}/availability?date=${dateStr}`);
    const avail = await availRes.json();
    assert.ok(avail.slots.length > 0);

    const bookRes = await fetch(`${baseUrl}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ product_id: serviceId, starts_at: avail.slots[0].starts_at }),
    });
    assert.equal(bookRes.status, 201);
    const appointment = await bookRes.json();
    assert.equal(appointment.status, "pendiente");

    const mineRes = await fetch(`${baseUrl}/appointments/me`, {
        headers: { Authorization: `Bearer ${customer.token}` },
    });
    const mine = await mineRes.json();
    assert.ok(mine.some((a) => a.id === appointment.id));
});
