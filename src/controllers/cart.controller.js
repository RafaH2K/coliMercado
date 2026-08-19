const pool = require("../config/db");

async function list(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT ci.product_id, ci.quantity, ci.updated_at,
                    p.name, p.price, p.stock, p.store_id, s.name AS store_name,
                    (s.mercadopago_user_id IS NOT NULL) AS mercadopago_connected,
                    (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position LIMIT 1) AS image_url
             FROM cart_items ci
             JOIN products p ON p.id = ci.product_id
             JOIN stores s ON s.id = p.store_id
             WHERE ci.user_id = $1
             ORDER BY ci.updated_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error("cart.list error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function add(req, res) {
    const { product_id, quantity } = req.body;
    const qty = Number.isInteger(quantity) ? quantity : 1;
    if (!product_id) {
        return res.status(400).json({ error: "product_id es requerido" });
    }
    if (qty < 1) {
        return res.status(400).json({ error: "quantity debe ser al menos 1" });
    }
    try {
        const { rows: productRows } = await pool.query(
            `SELECT p.stock FROM products p JOIN stores s ON s.id = p.store_id
             WHERE p.id = $1 AND p.type = 'product' AND p.is_active = TRUE AND s.is_active = TRUE AND s.is_admin_approved = TRUE`,
            [product_id]
        );
        const product = productRows[0];
        if (!product) return res.status(404).json({ error: "Producto no encontrado" });

        const { rows: existingRows } = await pool.query(
            `SELECT quantity FROM cart_items WHERE user_id = $1 AND product_id = $2`,
            [req.user.id, product_id]
        );
        const totalQty = (existingRows[0]?.quantity || 0) + qty;
        if (totalQty > product.stock) {
            return res.status(409).json({ error: `Solo hay ${product.stock} unidades disponibles` });
        }

        const { rows } = await pool.query(
            `INSERT INTO cart_items (user_id, product_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, product_id)
             DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = NOW()
             RETURNING *`,
            [req.user.id, product_id, qty]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("cart.add error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function updateQuantity(req, res) {
    const { quantity } = req.body;
    if (!Number.isInteger(quantity)) {
        return res.status(400).json({ error: "quantity debe ser un entero" });
    }
    try {
        if (quantity < 1) {
            await pool.query(`DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2`, [
                req.user.id,
                req.params.productId,
            ]);
            return res.status(204).send();
        }
        const { rows: cartRows } = await pool.query(
            `SELECT p.stock FROM cart_items ci JOIN products p ON p.id = ci.product_id
             WHERE ci.user_id = $1 AND ci.product_id = $2`,
            [req.user.id, req.params.productId]
        );
        if (!cartRows[0]) return res.status(404).json({ error: "No tienes ese producto en el carrito" });
        if (quantity > cartRows[0].stock) {
            return res.status(409).json({ error: `Solo hay ${cartRows[0].stock} unidades disponibles` });
        }
        const { rows } = await pool.query(
            `UPDATE cart_items SET quantity = $1, updated_at = NOW()
             WHERE user_id = $2 AND product_id = $3 RETURNING *`,
            [quantity, req.user.id, req.params.productId]
        );
        res.json(rows[0]);
    } catch (err) {
        console.error("cart.updateQuantity error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function remove(req, res) {
    try {
        await pool.query(`DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2`, [
            req.user.id,
            req.params.productId,
        ]);
        res.status(204).send();
    } catch (err) {
        console.error("cart.remove error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { list, add, updateQuantity, remove };
