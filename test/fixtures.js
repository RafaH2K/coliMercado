require("dotenv").config();
const pool = require("../src/config/db");

async function createUser({ isAdmin = false } = {}) {
    const email = `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, is_admin) VALUES ($1, 'x', $2) RETURNING id`,
        [email, isAdmin]
    );
    return rows[0].id;
}

// is_admin_approved/is_active = TRUE por default porque la mayoría de los
// fixtures son para probar carrito/pedidos/citas, no el flujo de aprobación
// en sí (ver admin.test.js, que sí pasa approved: false a propósito).
async function createStore(ownerId, { approved = true, active = true } = {}) {
    const { rows } = await pool.query(
        `INSERT INTO stores (owner_id, name, is_admin_approved, is_active) VALUES ($1, 'Test Store', $2, $3) RETURNING id`,
        [ownerId, approved, active]
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

async function createService(storeId, { price = 100, duration_minutes = 30, capacity = 1 } = {}) {
    const { rows } = await pool.query(
        `INSERT INTO products (store_id, name, type, price, duration_minutes, capacity)
         VALUES ($1, 'Test Service', 'service', $2, $3, $4) RETURNING id`,
        [storeId, price, duration_minutes, capacity]
    );
    return rows[0].id;
}

// Cada campo acepta un id suelto o un arreglo. Borra en el orden correcto
// para respetar las foreign keys.
async function cleanup({ userId, storeId, productId } = {}) {
    const userIds = [].concat(userId || []);
    const storeIds = [].concat(storeId || []);
    const productIds = [].concat(productId || []);

    if (userIds.length) {
        await pool.query(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1))`, [userIds]);
        await pool.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1))`, [userIds]);
        await pool.query(`DELETE FROM orders WHERE user_id = ANY($1)`, [userIds]);
        await pool.query(`DELETE FROM cart_items WHERE user_id = ANY($1)`, [userIds]);
        await pool.query(`DELETE FROM appointments WHERE customer_id = ANY($1)`, [userIds]);
    }
    if (productIds.length) {
        await pool.query(`DELETE FROM appointments WHERE product_id = ANY($1)`, [productIds]);
        await pool.query(`DELETE FROM products WHERE id = ANY($1)`, [productIds]);
    }
    if (storeIds.length) {
        await pool.query(
            `DELETE FROM appointments WHERE product_id IN (SELECT id FROM products WHERE store_id = ANY($1))`,
            [storeIds]
        );
        await pool.query(`DELETE FROM products WHERE store_id = ANY($1)`, [storeIds]);
        await pool.query(`DELETE FROM stores WHERE id = ANY($1)`, [storeIds]);
    }
    if (userIds.length) {
        await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    }
}

function mockRes() {
    const res = { statusCode: 200 }; // Express también responde 200 por default si no se llama a .status()
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
}

module.exports = { pool, createUser, createStore, createProduct, createService, cleanup, mockRes };
