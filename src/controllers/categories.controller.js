const pool = require("../config/db");

async function list(req, res) {
    try {
        const { rows } = await pool.query(`SELECT * FROM categories ORDER BY name`);
        res.json(rows);
    } catch (err) {
        console.error("categories.list error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { list };
