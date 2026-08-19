const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, createService, cleanup, mockRes } = require("./fixtures");
const requireAdmin = require("../src/middlewares/admin");
const admin = require("../src/controllers/admin.controller");
const storage = require("../src/lib/storage");
const stripe = require("../src/config/stripe");

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

test("purgeStore: negocio inexistente responde 404", async (t) => {
    const res = mockRes();
    await admin.purgeStore({ params: { id: "00000000-0000-0000-0000-000000000000" } }, res);
    assert.equal(res.statusCode, 404);
});

test("purgeStore: borra el negocio y TODO su contenido, y manda a borrar cada imagen del bucket", async (t) => {
    const ownerId = await createUser();
    const customerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    t.after(() => cleanup({ userId: [ownerId, customerId] })); // el store ya debería quedar borrado por purgeStore

    await pool.query(`UPDATE stores SET logo_url = $1 WHERE id = $2`, [
        "https://xxx.supabase.co/storage/v1/object/public/uploads/logo.jpg",
        storeId,
    ]);

    const productId = await createProduct(storeId);
    const serviceId = await createService(storeId);
    await pool.query(`INSERT INTO product_images (product_id, url) VALUES ($1, $2), ($1, $3)`, [
        productId,
        "https://xxx.supabase.co/storage/v1/object/public/uploads/foto1.jpg",
        "https://xxx.supabase.co/storage/v1/object/public/uploads/foto2.jpg",
    ]);

    const { rows: orderRows } = await pool.query(
        `INSERT INTO orders (user_id, store_id, total_amount, status) VALUES ($1, $2, 100, 'pagado') RETURNING id`,
        [customerId, storeId]
    );
    const orderId = orderRows[0].id;
    await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES ($1, $2, 1, 100)`,
        [orderId, productId]
    );
    await pool.query(
        `INSERT INTO payments (order_id, amount, provider, status, stripe_session_id) VALUES ($1, 100, 'stripe', 'pagado', 'cs_test_purge')`,
        [orderId]
    );
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)`, [customerId, productId]);
    await pool.query(
        `INSERT INTO appointments (product_id, customer_id, starts_at, ends_at, status)
         VALUES ($1, $2, NOW() + interval '1 day', NOW() + interval '1 day 30 minutes', 'confirmada')`,
        [serviceId, customerId]
    );
    await pool.query(`INSERT INTO reviews (store_id, user_id, rating) VALUES ($1, $2, 5)`, [storeId, customerId]);
    await pool.query(`INSERT INTO favorites (user_id, store_id) VALUES ($1, $2)`, [customerId, storeId]);
    await pool.query(
        `INSERT INTO business_hours (store_id, day_of_week, start_time, end_time) VALUES ($1, 1, '09:00', '18:00')`,
        [storeId]
    );

    const deletedUrls = [];
    const originalDeleteImage = storage.deleteImage;
    storage.deleteImage = (url) => deletedUrls.push(url);
    t.after(() => {
        storage.deleteImage = originalDeleteImage;
    });

    const res = mockRes();
    await admin.purgeStore({ params: { id: storeId } }, res);

    assert.equal(res.statusCode, 204);
    assert.equal(deletedUrls.length, 3, "debió mandar a borrar el logo + las 2 imágenes de producto");

    const { rows: storeRows } = await pool.query(`SELECT id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(storeRows.length, 0);
    const { rows: productRows } = await pool.query(`SELECT id FROM products WHERE store_id = $1`, [storeId]);
    assert.equal(productRows.length, 0);
    const { rows: imageRows } = await pool.query(`SELECT id FROM product_images WHERE product_id = ANY($1)`, [
        [productId, serviceId],
    ]);
    assert.equal(imageRows.length, 0);
    const { rows: orderRowsAfter } = await pool.query(`SELECT id FROM orders WHERE id = $1`, [orderId]);
    assert.equal(orderRowsAfter.length, 0);
    const { rows: orderItemRows } = await pool.query(`SELECT id FROM order_items WHERE order_id = $1`, [orderId]);
    assert.equal(orderItemRows.length, 0);
    const { rows: paymentRows } = await pool.query(`SELECT id FROM payments WHERE order_id = $1`, [orderId]);
    assert.equal(paymentRows.length, 0);
    const { rows: cartRows } = await pool.query(`SELECT id FROM cart_items WHERE user_id = $1`, [customerId]);
    assert.equal(cartRows.length, 0);
    const { rows: appointmentRows } = await pool.query(`SELECT id FROM appointments WHERE product_id = $1`, [serviceId]);
    assert.equal(appointmentRows.length, 0);
    const { rows: reviewRows } = await pool.query(`SELECT id FROM reviews WHERE store_id = $1`, [storeId]);
    assert.equal(reviewRows.length, 0);
    const { rows: favoriteRows } = await pool.query(`SELECT id FROM favorites WHERE store_id = $1`, [storeId]);
    assert.equal(favoriteRows.length, 0);
    const { rows: hoursRows } = await pool.query(`SELECT id FROM business_hours WHERE store_id = $1`, [storeId]);
    assert.equal(hoursRows.length, 0);
});

test("purgeStore: cancela la suscripción de Stripe activa del negocio", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    t.after(() => cleanup({ userId: ownerId }));
    await pool.query(`UPDATE stores SET stripe_subscription_id = 'sub_test_purge' WHERE id = $1`, [storeId]);

    const originalCancel = stripe.subscriptions.cancel;
    let canceledId = null;
    stripe.subscriptions.cancel = async (id) => {
        canceledId = id;
        return { id };
    };
    t.after(() => {
        stripe.subscriptions.cancel = originalCancel;
    });

    const res = mockRes();
    await admin.purgeStore({ params: { id: storeId } }, res);

    assert.equal(res.statusCode, 204);
    assert.equal(canceledId, "sub_test_purge");
});

test("purgeStore: si Stripe falla al cancelar la suscripción, no borra la tienda", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    t.after(() => cleanup({ userId: ownerId, storeId }));
    await pool.query(`UPDATE stores SET stripe_subscription_id = 'sub_test_purge_falla' WHERE id = $1`, [storeId]);

    const originalCancel = stripe.subscriptions.cancel;
    stripe.subscriptions.cancel = async () => {
        throw new Error("Stripe no respondió");
    };
    t.after(() => {
        stripe.subscriptions.cancel = originalCancel;
    });

    const res = mockRes();
    await admin.purgeStore({ params: { id: storeId } }, res);

    assert.equal(res.statusCode, 502);

    const { rows } = await pool.query(`SELECT id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows.length, 1, "la tienda no debió borrarse si la cancelación en Stripe falló");
});

test("purgeStore: la suscripción ya cancelada en Stripe (resource_missing) no bloquea la purga", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId, { approved: true });
    t.after(() => cleanup({ userId: ownerId }));
    await pool.query(`UPDATE stores SET stripe_subscription_id = 'sub_test_ya_cancelada' WHERE id = $1`, [storeId]);

    const originalCancel = stripe.subscriptions.cancel;
    stripe.subscriptions.cancel = async () => {
        const err = new Error("No such subscription");
        err.code = "resource_missing";
        throw err;
    };
    t.after(() => {
        stripe.subscriptions.cancel = originalCancel;
    });

    const res = mockRes();
    await admin.purgeStore({ params: { id: storeId } }, res);

    assert.equal(res.statusCode, 204);
});

after(() => pool.end());
