const pool = require("../config/db");

// Requiere montarse después de requireAuth. Carga la tienda de
// :storeId y exige que req.user sea su dueño; adjunta req.store.
async function requireStoreOwner(req, res, next) {
    try {
        const { rows } = await pool.query("SELECT id, owner_id FROM stores WHERE id = $1", [req.params.storeId]);
        const store = rows[0];
        if (!store) return res.status(404).json({ error: "Negocio no encontrado" });
        if (store.owner_id !== req.user.id) {
            return res.status(403).json({ error: "No eres dueño de este negocio" });
        }
        req.store = store;
        next();
    } catch (err) {
        console.error("requireStoreOwner error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = requireStoreOwner;
