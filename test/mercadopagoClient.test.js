const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyWebhookSignature } = require("../src/lib/mercadopago");

function sign({ dataId, requestId, ts, secret }) {
    const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
    return crypto.createHmac("sha256", secret).update(manifest).digest("hex");
}

test("verifyWebhookSignature: acepta una firma válida", () => {
    const secret = "test-webhook-secret";
    const ts = "1700000000000";
    const v1 = sign({ dataId: "123456", requestId: "req-1", ts, secret });

    const ok = verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: "req-1",
        dataId: "123456",
        secret,
    });
    assert.equal(ok, true);
});

test("verifyWebhookSignature: dataId es case-insensitive (siempre se compara en minúsculas)", () => {
    const secret = "test-webhook-secret";
    const ts = "1700000000000";
    const v1 = sign({ dataId: "abc123", requestId: "req-1", ts, secret });

    const ok = verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: "req-1",
        dataId: "ABC123",
        secret,
    });
    assert.equal(ok, true);
});

test("verifyWebhookSignature: rechaza una firma con secret incorrecto", () => {
    const ts = "1700000000000";
    const v1 = sign({ dataId: "123456", requestId: "req-1", ts, secret: "secret-correcto" });

    const ok = verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: "req-1",
        dataId: "123456",
        secret: "secret-incorrecto",
    });
    assert.equal(ok, false);
});

test("verifyWebhookSignature: rechaza si el dataId no coincide con el firmado", () => {
    const secret = "test-webhook-secret";
    const ts = "1700000000000";
    const v1 = sign({ dataId: "123456", requestId: "req-1", ts, secret });

    const ok = verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: "req-1",
        dataId: "otro-id",
        secret,
    });
    assert.equal(ok, false);
});

test("verifyWebhookSignature: rechaza un header x-signature mal formado", () => {
    const ok = verifyWebhookSignature({
        xSignature: "no-tiene-el-formato-esperado",
        xRequestId: "req-1",
        dataId: "123456",
        secret: "cualquier-secret",
    });
    assert.equal(ok, false);
});

test("verifyWebhookSignature: rechaza si falta la firma, el dataId o el secret", () => {
    assert.equal(verifyWebhookSignature({ xSignature: null, xRequestId: "r", dataId: "1", secret: "s" }), false);
    assert.equal(verifyWebhookSignature({ xSignature: "ts=1,v1=a", xRequestId: "r", dataId: null, secret: "s" }), false);
    assert.equal(verifyWebhookSignature({ xSignature: "ts=1,v1=a", xRequestId: "r", dataId: "1", secret: null }), false);
});
