require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const { encrypt, decrypt } = require("../src/lib/crypto");

test("encrypt/decrypt: round-trip devuelve el texto original", () => {
    const original = "APP_USR-1234567890-full-access-token";
    const payload = encrypt(original);
    assert.notEqual(payload, original, "no debe guardarse en texto plano");
    assert.equal(decrypt(payload), original);
});

test("encrypt: dos cifrados del mismo texto no son iguales (IV aleatorio)", () => {
    const a = encrypt("mismo-texto");
    const b = encrypt("mismo-texto");
    assert.notEqual(a, b);
    assert.equal(decrypt(a), "mismo-texto");
    assert.equal(decrypt(b), "mismo-texto");
});

test("decrypt: rechaza un payload manipulado (authTag no coincide)", () => {
    const payload = encrypt("secreto");
    const [iv, authTag, ciphertext] = payload.split(":");
    const tampered = [iv, authTag, Buffer.from("otra-cosa").toString("base64")].join(":");
    assert.throws(() => decrypt(tampered));
});
