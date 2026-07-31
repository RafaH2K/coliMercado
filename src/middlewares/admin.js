const pool = require("../config/db");

// Requiere montarse después de requireAuth. Consulta is_admin en cada
// petición (no se guarda en el JWT) para que revocar el permiso surta
// efecto de inmediato, sin esperar a que expiren los tokens ya emitidos.
async function requireAdmin(req, res, next) {
    try {
        const { rows } = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [req.user.id]);
        if (!rows[0]?.is_admin) {
            return res.status(403).json({ error: "Requiere permisos de administrador" });
        }
        next();
    } catch (err) {
        console.error("requireAdmin error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = requireAdmin;
