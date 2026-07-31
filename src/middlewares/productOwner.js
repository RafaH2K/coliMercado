const pool = require("../config/db");

// Requiere montarse después de requireAuth. Carga el producto (type='product')
// de :id junto con el dueño de su tienda; adjunta req.product.
async function requireProductOwner(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, s.owner_id
             FROM products p
             JOIN stores s ON s.id = p.store_id
             WHERE p.id = $1 AND p.type = 'product'`,
            [req.params.id]
        );
        const product = rows[0];
        if (!product) return res.status(404).json({ error: "Producto no encontrado" });
        if (product.owner_id !== req.user.id) {
            return res.status(403).json({ error: "No eres dueño de este producto" });
        }
        req.product = product;
        next();
    } catch (err) {
        console.error("requireProductOwner error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = requireProductOwner;
