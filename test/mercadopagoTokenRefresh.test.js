const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, createUser, createStore, cleanup } = require("./fixtures");
const { tick } = require("../src/jobs/mercadopagoTokenRefresh");
const mercadopago = require("../src/lib/mercadopago");
const { encrypt, decrypt } = require("../src/lib/crypto");

async function connectMercadoPago(storeId, { daysUntilExpiry }) {
    await pool.query(
        `UPDATE stores SET
            mercadopago_user_id = 123,
            mercadopago_access_token = $1,
            mercadopago_refresh_token = $2,
            mercadopago_token_expires_at = NOW() + ($3 || ' days')::interval
         WHERE id = $4`,
        [encrypt("access-token-viejo"), encrypt("refresh-token-viejo"), daysUntilExpiry, storeId]
    );
}

test("tick: renueva un token que vence dentro del margen y guarda el nuevo access/refresh token", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    await connectMercadoPago(storeId, { daysUntilExpiry: 5 }); // dentro del margen de 15 días
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const original = mercadopago.refreshAccessToken;
    let calledWith = null;
    mercadopago.refreshAccessToken = async (args) => {
        calledWith = args;
        return { access_token: "access-token-nuevo", refresh_token: "refresh-token-nuevo", expires_in: 15552000 };
    };
    t.after(() => {
        mercadopago.refreshAccessToken = original;
    });

    await tick();

    assert.equal(calledWith.refreshToken, "refresh-token-viejo");

    const { rows } = await pool.query(
        `SELECT mercadopago_access_token, mercadopago_refresh_token, mercadopago_token_expires_at FROM stores WHERE id = $1`,
        [storeId]
    );
    assert.equal(decrypt(rows[0].mercadopago_access_token), "access-token-nuevo");
    assert.equal(decrypt(rows[0].mercadopago_refresh_token), "refresh-token-nuevo");
    assert.ok(new Date(rows[0].mercadopago_token_expires_at) > new Date(Date.now() + 170 * 24 * 60 * 60 * 1000));
});

test("tick: no toca un token que todavía tiene tiempo de sobra", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    await connectMercadoPago(storeId, { daysUntilExpiry: 100 }); // fuera del margen de 15 días
    t.after(() => cleanup({ userId: ownerId, storeId }));

    let called = false;
    const original = mercadopago.refreshAccessToken;
    mercadopago.refreshAccessToken = async () => {
        called = true;
        return { access_token: "x", refresh_token: "y", expires_in: 1 };
    };
    t.after(() => {
        mercadopago.refreshAccessToken = original;
    });

    await tick();

    assert.equal(called, false, "no debió intentar renovar un token que todavía tiene tiempo de sobra");
    const { rows } = await pool.query(`SELECT mercadopago_access_token FROM stores WHERE id = $1`, [storeId]);
    assert.equal(decrypt(rows[0].mercadopago_access_token), "access-token-viejo");
});

test("tick: ignora tiendas nunca conectadas o ya desconectadas (sin refresh_token)", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    let called = false;
    const original = mercadopago.refreshAccessToken;
    mercadopago.refreshAccessToken = async () => {
        called = true;
        return { access_token: "x", refresh_token: "y", expires_in: 1 };
    };
    t.after(() => {
        mercadopago.refreshAccessToken = original;
    });

    await tick();

    assert.equal(called, false);
});

test("tick: si Mercado Pago rechaza la renovación de un negocio, sigue con los demás", async (t) => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const storeA = await createStore(ownerA); // este va a fallar
    const storeB = await createStore(ownerB); // este debe renovarse igual
    await connectMercadoPago(storeA, { daysUntilExpiry: 5 });
    await connectMercadoPago(storeB, { daysUntilExpiry: 5 });
    t.after(() => cleanup({ userId: [ownerA, ownerB], storeId: [storeA, storeB] }));

    // Ambas tiendas usan el mismo refresh_token de fixture -- se distinguen
    // por orden de llegada, no por valor: la primera llamada falla, la
    // segunda funciona, para probar que un fallo no detiene al resto.
    const original = mercadopago.refreshAccessToken;
    let callCount = 0;
    mercadopago.refreshAccessToken = async () => {
        callCount += 1;
        if (callCount === 1) throw new Error("refresh_token inválido o revocado");
        return { access_token: "access-token-nuevo", refresh_token: "refresh-token-nuevo", expires_in: 15552000 };
    };
    t.after(() => {
        mercadopago.refreshAccessToken = original;
    });

    await tick();

    assert.equal(callCount, 2, "debió intentar renovar ambas tiendas pese a que la primera falló");

    const { rows } = await pool.query(
        `SELECT id, mercadopago_access_token FROM stores WHERE id = ANY($1) ORDER BY id`,
        [[storeA, storeB]]
    );
    const renewed = rows.filter((r) => decrypt(r.mercadopago_access_token) === "access-token-nuevo");
    assert.equal(renewed.length, 1, "exactamente una de las dos tiendas debió quedar renovada");
});

after(() => pool.end());
