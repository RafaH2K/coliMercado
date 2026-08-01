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

// Al bajar de plan (cancelación al vencer el periodo, o downgrade manual a
// Free) el nuevo tope puede ser menor al catálogo activo actual. Desactiva
// los agregados más recientes hasta calzar en el límite; conserva el
// catálogo original del negocio. maxProducts NULL = ilimitado, no recorta.
async function trimToLimit(storeId, maxProducts) {
    if (maxProducts === null || maxProducts === undefined) return;
    await pool.query(
        `UPDATE products SET is_active = FALSE
         WHERE id IN (
             SELECT id FROM products
             WHERE store_id = $1 AND is_active = TRUE
             ORDER BY created_at ASC
             OFFSET $2
         )`,
        [storeId, maxProducts]
    );
}

module.exports = { enforceProductLimit, trimToLimit };
