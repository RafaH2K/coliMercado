const pool = require("../config/db");

async function add(req, res) {
    const { store_id } = req.body;
    if (!store_id) {
        return res.status(400).json({ error: "store_id es requerido" });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO favorites (user_id, store_id) VALUES ($1, $2)
             ON CONFLICT (user_id, store_id) DO NOTHING
             RETURNING *`,
            [req.user.id, store_id]
        );
        res.status(201).json(rows[0] || { user_id: req.user.id, store_id });
    } catch (err) {
        if (err.code === "23503") {
            return res.status(404).json({ error: "Negocio no encontrado" });
        }
        console.error("favorites.add error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function remove(req, res) {
    try {
        await pool.query(`DELETE FROM favorites WHERE user_id = $1 AND store_id = $2`, [
            req.user.id,
            req.params.storeId,
        ]);
        res.status(204).send();
    } catch (err) {
        console.error("favorites.remove error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function listMine(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT s.*, f.created_at AS favorited_at
             FROM favorites f JOIN stores s ON s.id = f.store_id
             WHERE f.user_id = $1
             ORDER BY f.created_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error("favorites.listMine error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { add, remove, listMine };
