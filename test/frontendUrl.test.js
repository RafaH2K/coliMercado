const test = require("node:test");
const assert = require("node:assert/strict");
const { frontendUrl } = require("../src/lib/frontendUrl");

test("frontendUrl: un solo origen se devuelve tal cual", () => {
    const original = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = "https://mercol.example.com";
    assert.equal(frontendUrl(), "https://mercol.example.com");
    process.env.CORS_ORIGIN = original;
});

test("frontendUrl: con varios orígenes separados por coma, usa el primero (regresión del bug de checkout)", () => {
    const original = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = "https://mercol.example.com,https://staging.mercol.example.com";
    assert.equal(frontendUrl(), "https://mercol.example.com");
    process.env.CORS_ORIGIN = original;
});

test("frontendUrl: le quita la barra final", () => {
    const original = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = "https://mercol.example.com/";
    assert.equal(frontendUrl(), "https://mercol.example.com");
    process.env.CORS_ORIGIN = original;
});
