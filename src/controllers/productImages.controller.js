const path = require("path");
const { unlink } = require("fs/promises");
const pool = require("../config/db");
const { UPLOAD_DIR } = require("../config/upload");

async function add(req, res) {
    const url = `/uploads/${req.file.filename}`;
    try {
        const { rows: posRows } = await pool.query(
            `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM product_images WHERE product_id = $1`,
            [req.params.id]
        );
        const { rows } = await pool.query(
            `INSERT INTO product_images (product_id, url, position) VALUES ($1, $2, $3) RETURNING *`,
            [req.params.id, url, posRows[0].next]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("productImages.add error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function remove(req, res) {
    try {
        const { rows } = await pool.query(
            `DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING url`,
            [req.params.imageId, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: "Imagen no encontrada" });
        if (rows[0].url.startsWith("/uploads/")) {
            unlink(path.join(UPLOAD_DIR, path.basename(rows[0].url))).catch(() => {});
        }
        res.status(204).send();
    } catch (err) {
        console.error("productImages.remove error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { add, remove };
