// Prueba dedicada: CORS_ORIGIN con una barra final (un error real que ya
// pasó en producción) debe seguir haciendo match contra el Origin real del
// navegador, que nunca trae esa barra. app.js lee CORS_ORIGIN una sola vez al
// cargar, así que se fuerza un require fresco con el valor de prueba.
const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool } = require("./fixtures");

test("CORS: un origen configurado con barra final igual hace match", async (t) => {
    const originalEnv = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = "https://con-barra-final.example.com/";
    delete require.cache[require.resolve("../src/app")];
    const app = require("../src/app");

    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        process.env.CORS_ORIGIN = originalEnv;
        delete require.cache[require.resolve("../src/app")];
    });

    const res = await fetch(`${baseUrl}/categories`, {
        headers: { Origin: "https://con-barra-final.example.com" }, // sin barra, como manda el navegador
    });

    assert.equal(res.headers.get("access-control-allow-origin"), "https://con-barra-final.example.com");
});

after(() => pool.end());
