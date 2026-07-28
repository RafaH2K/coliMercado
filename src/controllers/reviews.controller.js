const pool = require("../config/db");

// Reenviar el POST actualiza la propia reseña (una por cliente por negocio).
async function upsert(req, res) {
    const { rating, comment } = req.body;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "rating debe ser un entero entre 1 y 5" });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO reviews (store_id, user_id, rating, comment)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (store_id, user_id)
             DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()
             RETURNING *`,
            [req.params.storeId, req.user.id, rating, comment || null]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === "23503") {
            return res.status(404).json({ error: "Negocio no encontrado" });
        }
        console.error("reviews.upsert error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function listForStore(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT r.*, u.name AS customer_name
             FROM reviews r JOIN users u ON u.id = r.user_id
             WHERE r.store_id = $1
             ORDER BY r.created_at DESC`,
            [req.params.storeId]
        );
        res.json(rows);
    } catch (err) {
        console.error("reviews.listForStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { upsert, listForStore };
