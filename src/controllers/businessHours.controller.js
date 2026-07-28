const pool = require("../config/db");

async function getForStore(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT id, day_of_week, start_time, end_time FROM business_hours
             WHERE store_id = $1 ORDER BY day_of_week, start_time`,
            [req.params.storeId]
        );
        res.json(rows);
    } catch (err) {
        console.error("businessHours.getForStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Reemplaza el horario semanal completo del negocio con el arreglo enviado
// (más simple y menos propenso a errores que hacer CRUD fila por fila).
async function replaceForStore(req, res) {
    const hours = req.body.hours;
    if (!Array.isArray(hours)) {
        return res.status(400).json({ error: "Se esperaba un arreglo 'hours'" });
    }
    for (const h of hours) {
        if (
            !Number.isInteger(h.day_of_week) || h.day_of_week < 0 || h.day_of_week > 6 ||
            !h.start_time || !h.end_time
        ) {
            return res.status(400).json({
                error: "Cada horario necesita day_of_week (0=domingo..6=sábado), start_time y end_time",
            });
        }
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("DELETE FROM business_hours WHERE store_id = $1", [req.store.id]);
        for (const h of hours) {
            await client.query(
                `INSERT INTO business_hours (store_id, day_of_week, start_time, end_time)
                 VALUES ($1, $2, $3, $4)`,
                [req.store.id, h.day_of_week, h.start_time, h.end_time]
            );
        }
        await client.query("COMMIT");
        res.json({ ok: true, count: hours.length });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("businessHours.replaceForStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    } finally {
        client.release();
    }
}

module.exports = { getForStore, replaceForStore };
