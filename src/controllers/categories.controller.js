const pool = require("../config/db");

async function list(req, res) {
    const { kind } = req.query;
    if (kind && kind !== "service" && kind !== "product") {
        return res.status(400).json({ error: "kind debe ser 'service' o 'product'" });
    }
    try {
        const { rows } = await pool.query(
            `SELECT * FROM categories WHERE ($1::text IS NULL OR kind = $1) ORDER BY name`,
            [kind || null]
        );
        res.json(rows);
    } catch (err) {
        console.error("categories.list error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { list };
