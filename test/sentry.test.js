const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapConsoleError, enabled } = require("../src/config/sentry");

test("enabled: false sin SENTRY_DSN configurada (así corren estos tests)", () => {
    assert.equal(enabled, false);
});

test("wrapConsoleError: si hay un Error entre los argumentos, lo manda a captureException", () => {
    let capturedErr = null;
    const fakeSentry = {
        captureException: (e) => {
            capturedErr = e;
        },
        captureMessage: () => {
            throw new Error("no debió llamarse captureMessage");
        },
    };
    let loggedArgs = null;
    const wrapped = wrapConsoleError(fakeSentry, (...args) => {
        loggedArgs = args;
    });

    const err = new Error("algo tronó");
    wrapped("contexto:", err);

    assert.equal(capturedErr, err);
    assert.deepEqual(loggedArgs, ["contexto:", err], "el console.error original siempre se sigue llamando");
});

test("wrapConsoleError: sin un Error entre los argumentos, manda un mensaje a captureMessage", () => {
    let capturedMessage = null;
    const fakeSentry = {
        captureException: () => {
            throw new Error("no debió llamarse captureException");
        },
        captureMessage: (msg) => {
            capturedMessage = msg;
        },
    };
    const wrapped = wrapConsoleError(fakeSentry, () => {});

    wrapped("orders.updateStatus error:", "algo salió mal");

    assert.match(capturedMessage, /orders\.updateStatus error/);
    assert.match(capturedMessage, /algo salió mal/);
});

test("wrapConsoleError: nunca reemplaza el console.error original, solo lo envuelve", () => {
    let originalCalled = false;
    const fakeSentry = { captureException: () => {}, captureMessage: () => {} };
    const wrapped = wrapConsoleError(fakeSentry, () => {
        originalCalled = true;
    });

    wrapped("cualquier cosa");

    assert.equal(originalCalled, true);
});
