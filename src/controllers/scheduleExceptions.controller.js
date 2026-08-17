const pool = require("../config/db");
const { zonedTimeToUtc } = require("../lib/timezone");

// special_dates: reemplaza el horario del día completo (festivo o jornada especial).
async function listSpecialDates(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT id, date, is_closed, start_time, end_time, reason FROM special_dates
             WHERE store_id = $1 AND date >= CURRENT_DATE ORDER BY date`,
            [req.params.storeId]
        );
        res.json(rows);
    } catch (err) {
        console.error("scheduleExceptions.listSpecialDates error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Upsert por (store_id, date): guardar la misma fecha dos veces la reemplaza
// en vez de duplicarla (coincide con el UNIQUE(store_id, date) de la tabla).
async function upsertSpecialDate(req, res) {
    const { date, is_closed, start_time, end_time, reason } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date es requerido, formato YYYY-MM-DD" });
    }
    const closed = is_closed !== false;
    if (!closed && (!start_time || !end_time)) {
        return res.status(400).json({ error: "Si el día no está cerrado, start_time y end_time son requeridos" });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO special_dates (store_id, date, is_closed, start_time, end_time, reason)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (store_id, date) DO UPDATE SET
                is_closed = EXCLUDED.is_closed, start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time, reason = EXCLUDED.reason
             RETURNING *`,
            [req.store.id, date, closed, closed ? null : start_time, closed ? null : end_time, reason || null]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("scheduleExceptions.upsertSpecialDate error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function deleteSpecialDate(req, res) {
    try {
        const { rowCount } = await pool.query(`DELETE FROM special_dates WHERE id = $1 AND store_id = $2`, [
            req.params.id,
            req.store.id,
        ]);
        if (!rowCount) return res.status(404).json({ error: "No encontrado" });
        res.status(204).end();
    } catch (err) {
        console.error("scheduleExceptions.deleteSpecialDate error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// blocked_slots: bloqueos puntuales dentro de un día que sigue habilitado.
async function listBlockedSlots(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT id, starts_at, ends_at, reason FROM blocked_slots
             WHERE store_id = $1 AND ends_at > NOW() ORDER BY starts_at`,
            [req.params.storeId]
        );
        res.json(rows);
    } catch (err) {
        console.error("scheduleExceptions.listBlockedSlots error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// date/start_time/end_time son hora de pared del negocio (igual que
// business_hours/special_dates), no UTC — se convierten con la zona
// horaria de la tienda para no interpretarlas con la del servidor.
async function createBlockedSlot(req, res) {
    const { date, start_time, end_time, reason } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !start_time || !end_time) {
        return res.status(400).json({ error: "date (YYYY-MM-DD), start_time y end_time son requeridos" });
    }
    try {
        const { rows: storeRows } = await pool.query(`SELECT timezone FROM stores WHERE id = $1`, [req.store.id]);
        const start = zonedTimeToUtc(date, start_time, storeRows[0].timezone);
        const end = zonedTimeToUtc(date, end_time, storeRows[0].timezone);
        if (end <= start) {
            return res.status(400).json({ error: "end_time debe ser posterior a start_time" });
        }
        const { rows } = await pool.query(
            `INSERT INTO blocked_slots (store_id, starts_at, ends_at, reason) VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.store.id, start, end, reason || null]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("scheduleExceptions.createBlockedSlot error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function deleteBlockedSlot(req, res) {
    try {
        const { rowCount } = await pool.query(`DELETE FROM blocked_slots WHERE id = $1 AND store_id = $2`, [
            req.params.id,
            req.store.id,
        ]);
        if (!rowCount) return res.status(404).json({ error: "No encontrado" });
        res.status(204).end();
    } catch (err) {
        console.error("scheduleExceptions.deleteBlockedSlot error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = {
    listSpecialDates,
    upsertSpecialDate,
    deleteSpecialDate,
    listBlockedSlots,
    createBlockedSlot,
    deleteBlockedSlot,
};
