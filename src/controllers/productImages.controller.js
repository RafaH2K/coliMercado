const pool = require("../config/db");
const storage = require("../lib/storage");
const { recordAttestation } = require("../lib/imageAttestation");

async function add(req, res) {
    try {
        const url = await storage.uploadImage(req.file);
        const { rows: posRows } = await pool.query(
            `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM product_images WHERE product_id = $1`,
            [req.params.id]
        );
        const { rows } = await pool.query(
            `INSERT INTO product_images (product_id, url, position) VALUES ($1, $2, $3) RETURNING *`,
            [req.params.id, url, posRows[0].next]
        );
        // Se espera pero no puede tumbar la respuesta: la imagen ya se subió
        // de verdad, fallar aquí solo perdería el registro de auditoría, no
        // el upload -- eso solo se loggea.
        try {
            await recordAttestation({ userId: req.user.id, url, kind: "product_image" });
        } catch (err) {
            console.error("productImages.add: fallo guardando la atestación de derechos:", err.message);
        }
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
        storage.deleteImage(rows[0].url);
        res.status(204).send();
    } catch (err) {
        console.error("productImages.remove error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { add, remove };
