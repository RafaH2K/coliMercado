const pool = require("../config/db");

async function listPendingStores(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT s.id, s.name, s.description, s.city, s.phone, s.created_at,
                    u.name AS owner_name, u.email AS owner_email
             FROM stores s JOIN users u ON u.id = s.owner_id
             WHERE s.is_active = FALSE
             ORDER BY s.created_at ASC`
        );
        res.json(rows);
    } catch (err) {
        console.error("admin.listPendingStores error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function approveStore(req, res) {
    try {
        const { rows } = await pool.query(
            `UPDATE stores SET is_active = TRUE WHERE id = $1 AND is_active = FALSE RETURNING *`,
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: "Negocio no encontrado o ya estaba aprobado" });
        res.json(rows[0]);
    } catch (err) {
        console.error("admin.approveStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Rechazar borra el negocio pendiente. Si ya tiene productos/servicios/horario
// cargados la borrada falla por llave foránea; en ese caso se avisa en vez
// de tronar, en vez de cascadear borrados de contenido real del dueño.
async function rejectStore(req, res) {
    try {
        const { rows } = await pool.query(`DELETE FROM stores WHERE id = $1 AND is_active = FALSE RETURNING id`, [
            req.params.id,
        ]);
        if (!rows[0]) return res.status(404).json({ error: "Negocio no encontrado o ya estaba aprobado" });
        res.status(204).send();
    } catch (err) {
        if (err.code === "23503") {
            return res.status(409).json({
                error: "Este negocio ya tiene productos, servicios u horario configurados; no se puede rechazar automáticamente.",
            });
        }
        console.error("admin.rejectStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { listPendingStores, approveStore, rejectStore };
