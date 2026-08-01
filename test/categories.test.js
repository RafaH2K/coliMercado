const test = require("node:test");
const { after } = test;
const assert = require("node:assert/strict");
const { pool, mockRes } = require("./fixtures");
const categories = require("../src/controllers/categories.controller");

async function createCategory(name, kind) {
    const { rows } = await pool.query(`INSERT INTO categories (name, kind) VALUES ($1, $2) RETURNING id`, [
        name,
        kind,
    ]);
    return rows[0].id;
}

async function cleanupCategories(ids) {
    await pool.query(`DELETE FROM categories WHERE id = ANY($1)`, [ids]);
}

test("list: sin filtro devuelve categorías de ambos kinds", async (t) => {
    const svcId = await createCategory("Test Servicio XYZ", "service");
    const prodId = await createCategory("Test Producto XYZ", "product");
    t.after(() => cleanupCategories([svcId, prodId]));

    const res = mockRes();
    await categories.list({ query: {} }, res);

    assert.equal(res.statusCode, 200);
    const ids = res.body.map((c) => c.id);
    assert.ok(ids.includes(svcId));
    assert.ok(ids.includes(prodId));
});

test("list: filtra por kind='service' y excluye kind='product'", async (t) => {
    const svcId = await createCategory("Test Servicio Filtro", "service");
    const prodId = await createCategory("Test Producto Filtro", "product");
    t.after(() => cleanupCategories([svcId, prodId]));

    const res = mockRes();
    await categories.list({ query: { kind: "service" } }, res);

    const ids = res.body.map((c) => c.id);
    assert.ok(ids.includes(svcId));
    assert.ok(!ids.includes(prodId));
});

test("list: kind inválido responde 400", async (t) => {
    const res = mockRes();
    await categories.list({ query: { kind: "invalido" } }, res);

    assert.equal(res.statusCode, 400);
});

after(() => pool.end());
