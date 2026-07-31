const pool = require("../config/db");

async function list(req, res) {
    try {
        const { rows } = await pool.query(`SELECT * FROM plans ORDER BY price_mxn ASC`);
        res.json(rows);
    } catch (err) {
        console.error("plans.list error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { list };
