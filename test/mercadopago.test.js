const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { pool, createUser, createStore, cleanup, mockRes } = require("./fixtures");
const mercadopago = require("../src/controllers/mercadopago.controller");
const { decrypt } = require("../src/lib/crypto");
const { frontendUrl } = require("../src/lib/frontendUrl");

function mockFetchOnce(impl) {
    const original = global.fetch;
    global.fetch = impl;
    return () => {
        global.fetch = original;
    };
}

test("connect: arma la URL de autorización con un state firmado que decodifica al storeId correcto", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res = mockRes();
    await mercadopago.connect({ store: { id: storeId } }, res);

    assert.equal(res.statusCode, 200);
    const url = new URL(res.body.url);
    assert.equal(url.origin + url.pathname, "https://auth.mercadopago.com/authorization");
    assert.equal(url.searchParams.get("client_id"), process.env.MERCADOPAGO_CLIENT_ID);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("platform_id"), "mp");
    assert.equal(url.searchParams.get("redirect_uri"), process.env.MERCADOPAGO_REDIRECT_URI);

    const decoded = jwt.verify(url.searchParams.get("state"), process.env.JWT_SECRET);
    assert.equal(decoded.storeId, storeId);
});

test("connect: sin MERCADOPAGO_CLIENT_ID configurado responde 500 sin tronar", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const original = process.env.MERCADOPAGO_CLIENT_ID;
    delete process.env.MERCADOPAGO_CLIENT_ID;
    t.after(() => {
        process.env.MERCADOPAGO_CLIENT_ID = original;
    });

    const res = mockRes();
    await mercadopago.connect({ store: { id: storeId } }, res);

    assert.equal(res.statusCode, 500);
});

test("callback: code+state válidos guardan los tokens cifrados y redirige a ?mercadopago=connected", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const state = jwt.sign({ storeId }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const restoreFetch = mockFetchOnce(async (url, options) => {
        assert.equal(url, "https://api.mercadopago.com/oauth/token");
        const body = JSON.parse(options.body);
        assert.equal(body.grant_type, "authorization_code");
        assert.equal(body.code, "TG-fake-code");
        assert.equal(body.redirect_uri, process.env.MERCADOPAGO_REDIRECT_URI);
        return {
            ok: true,
            json: async () => ({
                access_token: "APP_USR-fake-access",
                refresh_token: "TG-fake-refresh",
                expires_in: 15552000,
                user_id: 999888777,
                public_key: "APP_USR-fake-public",
                live_mode: true,
            }),
        };
    });
    t.after(restoreFetch);

    const res = mockRes();
    await mercadopago.callback({ query: { code: "TG-fake-code", state } }, res);

    assert.equal(res.redirectedTo, `${frontendUrl()}/mi-negocio?mercadopago=connected`);

    const { rows } = await pool.query(
        `SELECT mercadopago_user_id, mercadopago_access_token, mercadopago_refresh_token, mercadopago_public_key, mercadopago_token_expires_at
         FROM stores WHERE id = $1`,
        [storeId]
    );
    assert.equal(rows[0].mercadopago_user_id, "999888777");
    assert.notEqual(rows[0].mercadopago_access_token, "APP_USR-fake-access", "no debe quedar en texto plano");
    assert.equal(decrypt(rows[0].mercadopago_access_token), "APP_USR-fake-access");
    assert.equal(decrypt(rows[0].mercadopago_refresh_token), "TG-fake-refresh");
    assert.equal(rows[0].mercadopago_public_key, "APP_USR-fake-public");
    assert.ok(rows[0].mercadopago_token_expires_at, "debe tener fecha de expiración");
});

test("callback: state inválido redirige a error sin llamar a Mercado Pago ni tocar la tienda", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    let called = false;
    const restoreFetch = mockFetchOnce(async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
    });
    t.after(restoreFetch);

    const res = mockRes();
    await mercadopago.callback({ query: { code: "x", state: "esto-no-es-un-jwt-valido" } }, res);

    assert.equal(res.redirectedTo, `${frontendUrl()}/mi-negocio?mercadopago=error`);
    assert.equal(called, false, "no debió llamar a Mercado Pago con un state inválido");

    const { rows } = await pool.query(`SELECT mercadopago_user_id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].mercadopago_user_id, null);
});

test("callback: si Mercado Pago rechaza el intercambio de code, redirige a error sin guardar nada", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const state = jwt.sign({ storeId }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const restoreFetch = mockFetchOnce(async () => ({ ok: false, status: 400 }));
    t.after(restoreFetch);

    const res = mockRes();
    await mercadopago.callback({ query: { code: "bad", state } }, res);

    assert.equal(res.redirectedTo, `${frontendUrl()}/mi-negocio?mercadopago=error`);
    const { rows } = await pool.query(`SELECT mercadopago_user_id FROM stores WHERE id = $1`, [storeId]);
    assert.equal(rows[0].mercadopago_user_id, null);
});

test("callback: si Mercado Pago manda ?error=..., redirige a error sin intentar nada", async (t) => {
    let called = false;
    const restoreFetch = mockFetchOnce(async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
    });
    t.after(restoreFetch);

    const res = mockRes();
    await mercadopago.callback({ query: { error: "access_denied" } }, res);

    assert.equal(res.redirectedTo, `${frontendUrl()}/mi-negocio?mercadopago=error`);
    assert.equal(called, false);
});

test("status: refleja connected=false antes de conectar y true después", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    const res1 = mockRes();
    await mercadopago.status({ store: { id: storeId } }, res1);
    assert.equal(res1.body.connected, false);

    await pool.query(`UPDATE stores SET mercadopago_user_id = 123 WHERE id = $1`, [storeId]);

    const res2 = mockRes();
    await mercadopago.status({ store: { id: storeId } }, res2);
    assert.equal(res2.body.connected, true);
});

test("disconnect: limpia las 5 columnas de mercadopago", async (t) => {
    const ownerId = await createUser();
    const storeId = await createStore(ownerId);
    t.after(() => cleanup({ userId: ownerId, storeId }));

    await pool.query(
        `UPDATE stores SET
            mercadopago_user_id = 123,
            mercadopago_access_token = 'x',
            mercadopago_refresh_token = 'y',
            mercadopago_public_key = 'z',
            mercadopago_token_expires_at = NOW()
         WHERE id = $1`,
        [storeId]
    );

    const res = mockRes();
    await mercadopago.disconnect({ store: { id: storeId } }, res);
    assert.equal(res.statusCode, 204);

    const { rows } = await pool.query(
        `SELECT mercadopago_user_id, mercadopago_access_token, mercadopago_refresh_token, mercadopago_public_key, mercadopago_token_expires_at
         FROM stores WHERE id = $1`,
        [storeId]
    );
    assert.equal(rows[0].mercadopago_user_id, null);
    assert.equal(rows[0].mercadopago_access_token, null);
    assert.equal(rows[0].mercadopago_refresh_token, null);
    assert.equal(rows[0].mercadopago_public_key, null);
    assert.equal(rows[0].mercadopago_token_expires_at, null);
});

after(() => pool.end());
