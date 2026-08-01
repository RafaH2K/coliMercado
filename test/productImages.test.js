const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, cleanup, mockRes } = require("./fixtures");
const productImages = require("../src/controllers/productImages.controller");
const storage = require("../src/lib/storage");

// uploadImage/deleteImage hacen una llamada de red real a Supabase Storage —
// en tests se reemplazan por fakes (mismo patrón que el stub de stripe en
// stores.test.js), así no dependen de credenciales ni de internet.
function fakeUpload(t, filename) {
    const original = storage.uploadImage;
    storage.uploadImage = async () => `/uploads/${filename}`;
    t.after(() => {
        storage.uploadImage = original;
    });
}

test("add: agrega una imagen con position 0 cuando no hay ninguna", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));
    fakeUpload(t, "foto1.jpg");

    const res = mockRes();
    await productImages.add({ params: { id: productId }, file: {} }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.url, "/uploads/foto1.jpg");
    assert.equal(res.body.position, 0);
});

test("add: la siguiente imagen toma la posición siguiente (MAX(position)+1)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));
    fakeUpload(t, "foto1.jpg");

    await productImages.add({ params: { id: productId }, file: {} }, mockRes());
    const res = mockRes();
    await productImages.add({ params: { id: productId }, file: {} }, res);

    assert.equal(res.body.position, 1);
});

test("remove: borra una imagen existente", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));
    fakeUpload(t, "foto1.jpg");

    const added = mockRes();
    await productImages.add({ params: { id: productId }, file: {} }, added);

    const res = mockRes();
    await productImages.remove({ params: { id: productId, imageId: added.body.id } }, res);

    assert.equal(res.statusCode, 204);
    const { rows } = await pool.query(`SELECT * FROM product_images WHERE id = $1`, [added.body.id]);
    assert.equal(rows.length, 0);
});

test("remove: 404 si la imagen no existe o no pertenece a ese producto", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));

    const res = mockRes();
    await productImages.remove(
        { params: { id: productId, imageId: "00000000-0000-0000-0000-000000000000" } },
        res
    );

    assert.equal(res.statusCode, 404);
});

test("remove: no borra una imagen de OTRO producto aunque el id de la imagen exista", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    const otherProductId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId: [productId, otherProductId] }));
    fakeUpload(t, "foto1.jpg");

    const added = mockRes();
    await productImages.add({ params: { id: productId }, file: {} }, added);

    const res = mockRes();
    await productImages.remove({ params: { id: otherProductId, imageId: added.body.id } }, res);

    assert.equal(res.statusCode, 404);
    const { rows } = await pool.query(`SELECT * FROM product_images WHERE id = $1`, [added.body.id]);
    assert.equal(rows.length, 1, "la imagen del producto correcto no debió tocarse");
});

after(() => pool.end());
