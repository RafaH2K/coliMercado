const test = require("node:test");
const assert = require("node:assert/strict");
const { frontendUrl } = require("../src/lib/frontendUrl");

function withEnv(vars, fn) {
    const originals = {};
    for (const key of Object.keys(vars)) {
        originals[key] = process.env[key];
        if (vars[key] === undefined) delete process.env[key];
        else process.env[key] = vars[key];
    }
    try {
        fn();
    } finally {
        for (const key of Object.keys(originals)) {
            if (originals[key] === undefined) delete process.env[key];
            else process.env[key] = originals[key];
        }
    }
}

test("frontendUrl: sin FRONTEND_URL, un solo CORS_ORIGIN se devuelve tal cual", () => {
    withEnv({ FRONTEND_URL: undefined, CORS_ORIGIN: "https://mercol.example.com" }, () => {
        assert.equal(frontendUrl(), "https://mercol.example.com");
    });
});

test("frontendUrl: sin FRONTEND_URL, con varios CORS_ORIGIN separados por coma usa el primero", () => {
    withEnv({ FRONTEND_URL: undefined, CORS_ORIGIN: "https://mercol.example.com,https://staging.mercol.example.com" }, () => {
        assert.equal(frontendUrl(), "https://mercol.example.com");
    });
});

test("frontendUrl: le quita la barra final", () => {
    withEnv({ FRONTEND_URL: undefined, CORS_ORIGIN: "https://mercol.example.com/" }, () => {
        assert.equal(frontendUrl(), "https://mercol.example.com");
    });
});

// Regresión: en producción CORS_ORIGIN suele traer localhost + el dominio
// real (para poder probar contra la BD de prod desde local), y localhost
// puede quedar primero en la lista — sin FRONTEND_URL, los links de Stripe/
// reset de password terminaban apuntando a localhost.
test("frontendUrl: con FRONTEND_URL seteada, gana sobre CORS_ORIGIN aunque localhost esté primero ahí", () => {
    withEnv(
        {
            FRONTEND_URL: "https://mercol.example.com",
            CORS_ORIGIN: "http://localhost:5173,https://mercol.example.com",
        },
        () => {
            assert.equal(frontendUrl(), "https://mercol.example.com");
        }
    );
});

test("frontendUrl: a FRONTEND_URL también le quita la barra final", () => {
    withEnv({ FRONTEND_URL: "https://mercol.example.com/", CORS_ORIGIN: undefined }, () => {
        assert.equal(frontendUrl(), "https://mercol.example.com");
    });
});
