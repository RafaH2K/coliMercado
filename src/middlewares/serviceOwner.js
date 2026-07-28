const pool = require("../config/db");

// Requiere montarse después de requireAuth. Carga el servicio (producto
// type='service') de :id junto con el dueño de su tienda; adjunta req.service.
async function requireServiceOwner(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, s.owner_id
             FROM products p
             JOIN stores s ON s.id = p.store_id
             WHERE p.id = $1 AND p.type = 'service'`,
            [req.params.id]
        );
        const service = rows[0];
        if (!service) return res.status(404).json({ error: "Servicio no encontrado" });
        if (service.owner_id !== req.user.id) {
            return res.status(403).json({ error: "No eres dueño de este servicio" });
        }
        req.service = service;
        next();
    } catch (err) {
        console.error("requireServiceOwner error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = requireServiceOwner;
