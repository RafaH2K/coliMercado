const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, createProduct, cleanup, mockRes } = require("./fixtures");
const productImages = require("../src/controllers/productImages.controller");
const stores = require("../src/controllers/stores.controller");
const storage = require("../src/lib/storage");

function fakeUpload(t, filename) {
    const original = storage.uploadImage;
    storage.uploadImage = async () => `/uploads/${filename}`;
    t.after(() => {
        storage.uploadImage = original;
    });
}

test("productImages.add: registra la atestación de derechos del usuario que subió la imagen", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));
    fakeUpload(t, "producto.jpg");

    const res = mockRes();
    await productImages.add({ params: { id: productId }, file: {}, user: { id: ownerId } }, res);

    assert.equal(res.statusCode, 201);
    const { rows } = await pool.query(
        `SELECT user_id, url, kind FROM image_upload_attestations WHERE url = $1`,
        ["/uploads/producto.jpg"]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, ownerId);
    assert.equal(rows[0].kind, "product_image");
});

test("stores.uploadLogo: registra la atestación de derechos del dueño que subió el logo", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));
    fakeUpload(t, "logo.jpg");

    const res = mockRes();
    await stores.uploadLogo({ store: { id: storeId }, user: { id: ownerId }, file: {} }, res);

    assert.equal(res.statusCode, 200);
    const { rows } = await pool.query(`SELECT user_id, url, kind FROM image_upload_attestations WHERE url = $1`, [
        "/uploads/logo.jpg",
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, ownerId);
    assert.equal(rows[0].kind, "logo");
});

test("productImages.add: si falla el registro de atestación, la imagen igual queda subida (no tumba la respuesta)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    const productId = await createProduct(storeId);
    t.after(() => cleanup({ userId: ownerId, storeId, productId }));
    fakeUpload(t, "producto2.jpg");

    const res = mockRes();
    // user_id inexistente -> INSERT en image_upload_attestations viola la FK
    // y falla, pero el producto_images ya se insertó antes.
    await productImages.add(
        { params: { id: productId }, file: {}, user: { id: "00000000-0000-0000-0000-000000000000" } },
        res
    );

    assert.equal(res.statusCode, 201, "el upload de la imagen no debe fallar por un error en la atestación");
    const { rows } = await pool.query(`SELECT * FROM product_images WHERE id = $1`, [res.body.id]);
    assert.equal(rows.length, 1);
});

after(() => pool.end());
