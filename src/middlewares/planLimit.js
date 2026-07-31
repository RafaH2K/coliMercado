const pool = require("../config/db");

// Se monta después de requireStoreOwner en los POST de crear producto/servicio.
// Un solo tope para ambos: comparten la misma tabla `products`, así que un
// límite separado por tipo dejaría duplicar el cupo real solo cambiando `type`.
async function enforceProductLimit(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT
                CASE WHEN s.plan_id IS NULL THEN (SELECT max_products FROM plans WHERE code = 'free') ELSE pl.max_products END AS max_products,
                (SELECT COUNT(*) FROM products WHERE store_id = s.id AND is_active = TRUE) AS current_count
             FROM stores s LEFT JOIN plans pl ON pl.id = s.plan_id
             WHERE s.id = $1`,
            [req.store.id]
        );
        const { max_products, current_count } = rows[0];
        if (max_products !== null && Number(current_count) >= max_products) {
            return res.status(403).json({
                error: `Tu plan permite hasta ${max_products} productos/servicios activos. Desactiva alguno o mejora tu plan para agregar más.`,
            });
        }
        next();
    } catch (err) {
        console.error("enforceProductLimit error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = enforceProductLimit;
