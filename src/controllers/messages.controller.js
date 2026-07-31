const pool = require("../config/db");

// "kind" solo toma los dos valores fijos de abajo (nunca viene del request),
// así que interpolarlo en las queries de más abajo (${kind}_id) es seguro.
const THREAD_QUERIES = {
    order: `SELECT o.user_id AS customer_id, s.owner_id AS store_owner_id
            FROM orders o JOIN stores s ON s.id = o.store_id WHERE o.id = $1`,
    appointment: `SELECT a.customer_id, s.owner_id AS store_owner_id
                  FROM appointments a
                  JOIN products p ON p.id = a.product_id
                  JOIN stores s ON s.id = p.store_id
                  WHERE a.id = $1`,
};

// El cliente (dueño del pedido/cita) o el dueño de la tienda pueden leer y
// escribir en ese hilo; nadie más.
async function canAccessThread(kind, id, userId) {
    const { rows } = await pool.query(THREAD_QUERIES[kind], [id]);
    const row = rows[0];
    return !!row && (row.customer_id === userId || row.store_owner_id === userId);
}

async function listMessages(kind, req, res) {
    try {
        if (!(await canAccessThread(kind, req.params.id, req.user.id))) {
            return res.status(404).json({ error: "No encontrado" });
        }
        const { rows } = await pool.query(
            `SELECT * FROM messages WHERE ${kind}_id = $1 ORDER BY created_at ASC`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(`messages.list(${kind}) error:`, err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function createMessage(kind, req, res) {
    const { body } = req.body;
    if (!body || !body.trim()) {
        return res.status(400).json({ error: "El mensaje no puede estar vacío" });
    }
    try {
        if (!(await canAccessThread(kind, req.params.id, req.user.id))) {
            return res.status(404).json({ error: "No encontrado" });
        }
        const { rows } = await pool.query(
            `INSERT INTO messages (${kind}_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *`,
            [req.params.id, req.user.id, body.trim()]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error(`messages.create(${kind}) error:`, err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = {
    listForOrder: (req, res) => listMessages("order", req, res),
    createForOrder: (req, res) => createMessage("order", req, res),
    listForAppointment: (req, res) => listMessages("appointment", req, res),
    createForAppointment: (req, res) => createMessage("appointment", req, res),
};
