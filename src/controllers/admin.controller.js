const pool = require("../config/db");

const STORE_ADMIN_FIELDS = `
    s.id, s.name, s.description, s.city, s.phone, s.is_active, s.created_at,
    u.name AS owner_name, u.email AS owner_email
`;

async function listPendingStores(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT ${STORE_ADMIN_FIELDS}
             FROM stores s JOIN users u ON u.id = s.owner_id
             WHERE s.is_admin_approved = FALSE
             ORDER BY s.created_at ASC`
        );
        res.json(rows);
    } catch (err) {
        console.error("admin.listPendingStores error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Negocios ya aprobados, para el panel de suspender/reactivar. Los
// suspendidos primero, para que salten a la vista.
async function listApprovedStores(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT ${STORE_ADMIN_FIELDS}
             FROM stores s JOIN users u ON u.id = s.owner_id
             WHERE s.is_admin_approved = TRUE
             ORDER BY s.is_active ASC, s.name ASC`
        );
        res.json(rows);
    } catch (err) {
        console.error("admin.listApprovedStores error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function approveStore(req, res) {
    try {
        const { rows } = await pool.query(
            `UPDATE stores SET is_admin_approved = TRUE WHERE id = $1 AND is_admin_approved = FALSE RETURNING *`,
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
        const { rows } = await pool.query(
            `DELETE FROM stores WHERE id = $1 AND is_admin_approved = FALSE RETURNING id`,
            [req.params.id]
        );
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

// Suspende/reactiva un negocio YA aprobado. Es una bandera separada de
// is_admin_approved a propósito: si reutilizara esa misma columna, suspender
// un negocio activo lo haría reaparecer en la lista de pendientes.
async function setActive(req, res) {
    const { is_active } = req.body;
    if (typeof is_active !== "boolean") {
        return res.status(400).json({ error: "is_active debe ser true o false" });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE stores SET is_active = $1 WHERE id = $2 AND is_admin_approved = TRUE RETURNING *`,
            [is_active, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: "Negocio no encontrado o aún no está aprobado" });
        res.json(rows[0]);
    } catch (err) {
        console.error("admin.setActive error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { listPendingStores, listApprovedStores, approveStore, rejectStore, setActive };
