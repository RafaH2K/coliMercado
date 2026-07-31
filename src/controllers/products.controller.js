const pool = require("../config/db");

const IMAGES_SUBQUERY = `
    COALESCE(
        (SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url, 'position', pi.position) ORDER BY pi.position)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'
    ) AS images
`;

const PAGE_SIZE = 24;

async function search(req, res) {
    const { q, category_id, city, page } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    try {
        const { rows } = await pool.query(
            `SELECT p.*, s.name AS store_name, s.city AS store_city, ${IMAGES_SUBQUERY}
             FROM products p JOIN stores s ON s.id = p.store_id
             WHERE p.type = 'product' AND p.is_active = TRUE AND s.is_active = TRUE
               AND ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%' OR p.description ILIKE '%' || $1 || '%')
               AND ($2::uuid IS NULL OR p.category_id = $2)
               AND ($3::text IS NULL OR s.city ILIKE '%' || $3 || '%')
             ORDER BY p.created_at DESC
             LIMIT $4 OFFSET $5`,
            [q || null, category_id || null, city || null, PAGE_SIZE, (pageNum - 1) * PAGE_SIZE]
        );
        res.json(rows);
    } catch (err) {
        console.error("products.search error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function listForStore(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, ${IMAGES_SUBQUERY}
             FROM products p
             WHERE p.store_id = $1 AND p.type = 'product' AND p.is_active = TRUE
             ORDER BY p.created_at DESC`,
            [req.params.storeId]
        );
        res.json(rows);
    } catch (err) {
        console.error("products.listForStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function create(req, res) {
    const { name, description, price, stock, category_id } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: "El nombre del producto es requerido" });
    }
    if (!(price > 0)) {
        return res.status(400).json({ error: "El precio debe ser mayor a 0" });
    }
    if (!Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({ error: "stock debe ser un entero mayor o igual a 0" });
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO products (store_id, category_id, name, description, type, price, stock)
             VALUES ($1, $2, $3, $4, 'product', $5, $6)
             RETURNING *`,
            [req.store.id, category_id || null, name, description || null, price, stock]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("products.create error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function getById(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, s.name AS store_name, s.city AS store_city, ${IMAGES_SUBQUERY}
             FROM products p JOIN stores s ON s.id = p.store_id
             WHERE p.id = $1 AND p.type = 'product'`,
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: "Producto no encontrado" });
        res.json(rows[0]);
    } catch (err) {
        console.error("products.getById error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function update(req, res) {
    const { name, description, price, stock, is_active, category_id } = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE products SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                price = COALESCE($3, price),
                stock = COALESCE($4, stock),
                is_active = COALESCE($5, is_active),
                category_id = COALESCE($6, category_id),
                updated_at = NOW()
             WHERE id = $7
             RETURNING *`,
            [name, description, price, stock, is_active, category_id, req.product.id]
        );
        res.json(rows[0]);
    } catch (err) {
        console.error("products.update error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { search, listForStore, create, getById, update };
