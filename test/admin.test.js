const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, cleanup, mockRes } = require("./fixtures");
const requireAdmin = require("../src/middlewares/admin");
const admin = require("../src/controllers/admin.controller");

test("requireAdmin rechaza a un usuario que no es admin", async (t) => {
    const userId = await createUser();
    t.after(() => cleanup({ userId }));

    const res = mockRes();
    let nextCalled = false;
    await requireAdmin({ user: { id: userId } }, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 403);
    assert.equal(nextCalled, false);
});

test("requireAdmin deja pasar a un admin", async (t) => {
    const userId = await createUser({ isAdmin: true });
    t.after(() => cleanup({ userId }));

    const res = mockRes();
    let nextCalled = false;
    await requireAdmin({ user: { id: userId } }, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
});

test("ciclo completo: pendiente -> aprobar -> suspender -> reactivar, sin conflacion", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId, { approved: false });
    t.after(() => cleanup({ userId, storeId }));

    // 1. aparece como pendiente
    const pendingRes = mockRes();
    await admin.listPendingStores({}, pendingRes);
    assert.ok(pendingRes.body.some((s) => s.id === storeId));

    // 2. aprobar
    const approveRes = mockRes();
    await admin.approveStore({ params: { id: storeId } }, approveRes);
    assert.equal(approveRes.statusCode, 200);
    assert.equal(approveRes.body.is_admin_approved, true);

    // 3. ya no aparece como pendiente
    const pendingRes2 = mockRes();
    await admin.listPendingStores({}, pendingRes2);
    assert.ok(!pendingRes2.body.some((s) => s.id === storeId));

    // 4. aparece como aprobado, activo
    const approvedRes = mockRes();
    await admin.listApprovedStores({}, approvedRes);
    const asApproved = approvedRes.body.find((s) => s.id === storeId);
    assert.ok(asApproved);
    assert.equal(asApproved.is_active, true);

    // 5. suspender
    const suspendRes = mockRes();
    await admin.setActive({ params: { id: storeId }, body: { is_active: false } }, suspendRes);
    assert.equal(suspendRes.statusCode, 200);
    assert.equal(suspendRes.body.is_active, false);

    // 6. REGRESIÓN CLAVE: un negocio suspendido (pero ya aprobado) no debe
    // reaparecer en la lista de pendientes.
    const pendingRes3 = mockRes();
    await admin.listPendingStores({}, pendingRes3);
    assert.ok(!pendingRes3.body.some((s) => s.id === storeId), "un negocio suspendido no debió reaparecer como pendiente");

    // 7. sigue en la lista de aprobados, ahora marcado inactivo
    const approvedRes2 = mockRes();
    await admin.listApprovedStores({}, approvedRes2);
    assert.equal(approvedRes2.body.find((s) => s.id === storeId).is_active, false);

    // 8. reactivar
    const reactivateRes = mockRes();
    await admin.setActive({ params: { id: storeId }, body: { is_active: true } }, reactivateRes);
    assert.equal(reactivateRes.body.is_active, true);
});

test("approveStore en un negocio ya aprobado responde 404", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId, { approved: true });
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await admin.approveStore({ params: { id: storeId } }, res);
    assert.equal(res.statusCode, 404);
});

test("setActive en un negocio aun pendiente responde 404 (no se puede suspender antes de aprobar)", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId, { approved: false });
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await admin.setActive({ params: { id: storeId }, body: { is_active: false } }, res);
    assert.equal(res.statusCode, 404);
});

test("rejectStore borra un negocio pendiente sin contenido", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId, { approved: false });
    t.after(() => cleanup({ userId }));

    const res = mockRes();
    await admin.rejectStore({ params: { id: storeId } }, res);
    assert.equal(res.statusCode, 204);

    const { rows } = await pool.query(`SELECT id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows.length, 0);
});

test("rejectStore en un negocio pendiente CON productos responde 409 y no lo borra", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId, { approved: false });
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId, storeId, productId }));

    const res = mockRes();
    await admin.rejectStore({ params: { id: storeId } }, res);
    assert.equal(res.statusCode, 409);

    const { rows } = await pool.query(`SELECT id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows.length, 1, "el negocio con contenido no debió borrarse");
});

after(() => pool.end());
