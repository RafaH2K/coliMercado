require("dotenv").config();
const pool = require("../src/config/db");

async function createUser() {
    const email = `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`,
        [email]
    );
    return rows[0].id;
}

// is_admin_approved = TRUE porque estos fixtures son para probar carrito/
// pedidos, no el flujo de aprobación en sí (ver admin.test.js para eso).
async function createStore(ownerId) {
    const { rows } = await pool.query(
        `INSERT INTO stores (owner_id, name, is_admin_approved) VALUES ($1, 'Test Store', TRUE) RETURNING id`,
        [ownerId]
    );
    return rows[0].id;
}

async function createProduct(storeId, { price = 100, stock = 5 } = {}) {
    const { rows } = await pool.query(
        `INSERT INTO products (store_id, name, type, price, stock) VALUES ($1, 'Test Product', 'product', $2, $3) RETURNING id`,
        [storeId, price, stock]
    );
    return rows[0].id;
}

// Borra en el orden correcto para respetar las foreign keys.
async function cleanup({ userId, storeId, productId }) {
    if (userId) {
        await pool.query(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`, [userId]);
        await pool.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`, [userId]);
        await pool.query(`DELETE FROM orders WHERE user_id = $1`, [userId]);
        await pool.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);
    }
    if (productId) await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
    if (storeId) await pool.query(`DELETE FROM stores WHERE id = $1`, [storeId]);
    if (userId) await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

function mockRes() {
    const res = { statusCode: 200 }; // Express también responde 200 por default si no se llama a .status()
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
}

module.exports = { pool, createUser, createStore, createProduct, cleanup, mockRes };
