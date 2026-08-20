const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { pool, createUser, createStore, createProduct, cleanup, mockRes } = require("./fixtures");
const auth = require("../src/controllers/auth.controller");

test("deleteAccount: anonimiza al cliente (sin negocio) y ya no puede volver a entrar", async (t) => {
    const userId = await createUser();
    t.after(() => cleanup({ userId }));

    const res = mockRes();
    await auth.deleteAccount({ user: { id: userId } }, res);

    assert.equal(res.statusCode, 204);

    const { rows } = await pool.query(
        `SELECT name, email, phone, reset_token_hash, deleted_at FROM users WHERE id = $1`,
        [userId]
    );
    assert.equal(rows[0].name, null);
    assert.equal(rows[0].phone, null);
    assert.equal(rows[0].reset_token_hash, null);
    assert.match(rows[0].email, /^eliminado-.+@eliminado\.local$/);
    assert.ok(rows[0].deleted_at, "debe quedar marcada la fecha de borrado");
});

test("deleteAccount: la contraseña anterior deja de servir tras el borrado", async (t) => {
    const userId = await createUser();
    t.after(() => cleanup({ userId }));

    await auth.deleteAccount({ user: { id: userId } }, mockRes());

    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    // fixtures.createUser guarda password_hash = 'x' (no un hash real); tras
    // el borrado debe ser un hash bcrypt de verdad que no valide contra nada
    // que el usuario conozca.
    assert.notEqual(rows[0].password_hash, "x");
    assert.equal(await bcrypt.compare("cualquier-cosa", rows[0].password_hash), false);
});

test("deleteAccount: bloquea si el usuario es dueño de un negocio", async (t) => {
    const userId = await createUser();
    const storeId = await createStore(userId);
    t.after(() => cleanup({ userId, storeId }));

    const res = mockRes();
    await auth.deleteAccount({ user: { id: userId } }, res);

    assert.equal(res.statusCode, 409);
    const { rows } = await pool.query(`SELECT deleted_at, email FROM users WHERE id = $1`, [userId]);
    assert.equal(rows[0].deleted_at, null, "no debió tocarse la cuenta");
});

test("deleteAccount: bloquea si el usuario es administrador", async (t) => {
    const adminId = await createUser({ isAdmin: true });
    t.after(() => cleanup({ userId: adminId }));

    const res = mockRes();
    await auth.deleteAccount({ user: { id: adminId } }, res);

    assert.equal(res.statusCode, 409);
    const { rows } = await pool.query(`SELECT deleted_at FROM users WHERE id = $1`, [adminId]);
    assert.equal(rows[0].deleted_at, null);
});

test("deleteAccount: borra el carrito y los favoritos del usuario", async (t) => {
    const userId = await createUser();
    const otherOwnerId = await createUser();
    const otherStoreId = await createStore(otherOwnerId, { approved: true });
    const otherProductId = await createProduct(otherStoreId);
    t.after(() => cleanup({ userId: [userId, otherOwnerId], storeId: otherStoreId, productId: otherProductId }));

    await pool.query(`INSERT INTO favorites (user_id, store_id) VALUES ($1, $2)`, [userId, otherStoreId]);
    await pool.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)`, [
        userId,
        otherProductId,
    ]);

    await auth.deleteAccount({ user: { id: userId } }, mockRes());

    const { rows: favRows } = await pool.query(`SELECT * FROM favorites WHERE user_id = $1`, [userId]);
    const { rows: cartRows } = await pool.query(`SELECT * FROM cart_items WHERE user_id = $1`, [userId]);
    assert.equal(favRows.length, 0);
    assert.equal(cartRows.length, 0);
});

test("deleteAccount: una cuenta ya borrada responde 404 si se intenta de nuevo", async (t) => {
    const userId = await createUser();
    t.after(() => cleanup({ userId }));

    await auth.deleteAccount({ user: { id: userId } }, mockRes());
    const second = mockRes();
    await auth.deleteAccount({ user: { id: userId } }, second);

    assert.equal(second.statusCode, 404);
});

after(() => pool.end());
