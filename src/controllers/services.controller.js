const pool = require("../config/db");
const { generateCandidateSlots, filterAvailable } = require("../lib/availability");
const { zonedTimeToUtc, addDays } = require("../lib/timezone");

// Reutilizado por listForStore/getById: agrega las fotos de cada servicio como JSON.
const IMAGES_SUBQUERY = `
    COALESCE(
        (SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url, 'position', pi.position) ORDER BY pi.position)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'
    ) AS images
`;

async function search(req, res) {
    const { q, category_id, city } = req.query;
    try {
        const { rows } = await pool.query(
            `SELECT p.*, s.name AS store_name, s.city AS store_city, s.timezone AS store_timezone
             FROM products p JOIN stores s ON s.id = p.store_id
             WHERE p.type = 'service' AND p.is_active = TRUE AND s.is_active = TRUE
               AND ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%' OR p.description ILIKE '%' || $1 || '%')
               AND ($2::uuid IS NULL OR p.category_id = $2)
               AND ($3::text IS NULL OR s.city ILIKE '%' || $3 || '%')
             ORDER BY p.created_at DESC
             LIMIT 50`,
            [q || null, category_id || null, city || null]
        );
        res.json(rows);
    } catch (err) {
        console.error("services.search error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function listForStore(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, ${IMAGES_SUBQUERY}
             FROM products p
             WHERE p.store_id = $1 AND p.type = 'service' AND p.is_active = TRUE
             ORDER BY p.created_at DESC`,
            [req.params.storeId]
        );
        res.json(rows);
    } catch (err) {
        console.error("services.listForStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function create(req, res) {
    const { name, description, price, duration_minutes, buffer_minutes, capacity, category_id } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: "El nombre del servicio es requerido" });
    }
    if (!(price > 0)) {
        return res.status(400).json({ error: "El precio debe ser mayor a 0" });
    }
    if (!Number.isInteger(duration_minutes) || duration_minutes <= 0) {
        return res.status(400).json({ error: "duration_minutes debe ser un entero positivo (minutos)" });
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO products (store_id, category_id, name, description, type, price, duration_minutes, buffer_minutes, capacity)
             VALUES ($1, $2, $3, $4, 'service', $5, $6, $7, $8)
             RETURNING *`,
            [
                req.store.id,
                category_id || null,
                name,
                description || null,
                price,
                duration_minutes,
                buffer_minutes || 0,
                capacity || 1,
            ]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("services.create error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function getById(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, s.timezone AS store_timezone, ${IMAGES_SUBQUERY}
             FROM products p JOIN stores s ON s.id = p.store_id
             WHERE p.id = $1 AND p.type = 'service'`,
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: "Servicio no encontrado" });
        res.json(rows[0]);
    } catch (err) {
        console.error("services.getById error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function update(req, res) {
    const { name, description, price, duration_minutes, buffer_minutes, capacity, is_active, category_id } = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE products SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                price = COALESCE($3, price),
                duration_minutes = COALESCE($4, duration_minutes),
                buffer_minutes = COALESCE($5, buffer_minutes),
                capacity = COALESCE($6, capacity),
                is_active = COALESCE($7, is_active),
                category_id = COALESCE($8, category_id),
                updated_at = NOW()
             WHERE id = $9
             RETURNING *`,
            [
                name,
                description,
                price,
                duration_minutes,
                buffer_minutes,
                capacity,
                is_active,
                category_id,
                req.service.id,
            ]
        );
        res.json(rows[0]);
    } catch (err) {
        console.error("services.update error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Los TIME de business_hours/special_dates son hora de pared en `timezone`
// (la del negocio), no UTC — hay que convertirlos con zonedTimeToUtc.
async function getDayWindows(storeId, date, dayOfWeek, timezone) {
    const { rows: special } = await pool.query(
        `SELECT is_closed, start_time, end_time FROM special_dates WHERE store_id = $1 AND date = $2`,
        [storeId, date]
    );
    if (special[0]) {
        if (special[0].is_closed) return [];
        return [
            {
                start: zonedTimeToUtc(date, special[0].start_time, timezone),
                end: zonedTimeToUtc(date, special[0].end_time, timezone),
            },
        ];
    }

    const { rows: hours } = await pool.query(
        `SELECT start_time, end_time FROM business_hours WHERE store_id = $1 AND day_of_week = $2`,
        [storeId, dayOfWeek]
    );
    return hours.map((h) => ({
        start: zonedTimeToUtc(date, h.start_time, timezone),
        end: zonedTimeToUtc(date, h.end_time, timezone),
    }));
}

async function availability(req, res) {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Parámetro 'date' requerido, formato YYYY-MM-DD" });
    }

    try {
        const { rows: productRows } = await pool.query(
            `SELECT p.*, s.timezone AS store_timezone
             FROM products p JOIN stores s ON s.id = p.store_id
             WHERE p.id = $1 AND p.type = 'service' AND p.is_active = TRUE`,
            [req.params.id]
        );
        const service = productRows[0];
        if (!service || !service.duration_minutes) {
            return res.status(404).json({ error: "Servicio no encontrado o sin duración configurada" });
        }

        // day_of_week es la fecha del calendario tal cual (no depende de zona);
        // dayStart/dayEnd sí son instantes UTC reales del día en la zona del negocio.
        const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
        const dayStart = zonedTimeToUtc(date, "00:00:00", service.store_timezone);
        const dayEnd = zonedTimeToUtc(addDays(date, 1), "00:00:00", service.store_timezone);
        const windows = await getDayWindows(service.store_id, date, dayOfWeek, service.store_timezone);
        if (windows.length === 0) {
            return res.json({ slots: [] });
        }

        const { rows: busyAppointments } = await pool.query(
            `SELECT starts_at AS start, ends_at AS "end" FROM appointments
             WHERE product_id = $1 AND status IN ('pendiente','confirmada')
               AND starts_at < $3 AND ends_at > $2`,
            [service.id, dayStart, dayEnd]
        );
        const { rows: blocked } = await pool.query(
            `SELECT starts_at AS start, ends_at AS "end" FROM blocked_slots
             WHERE store_id = $1 AND starts_at < $3 AND ends_at > $2`,
            [service.store_id, dayStart, dayEnd]
        );

        const candidates = generateCandidateSlots(windows, service.duration_minutes, service.buffer_minutes || 0);
        // Un bloqueo cierra el negocio entero en ese rango (capacity efectiva 1: ocupado = no disponible).
        const withoutBlocked = filterAvailable(candidates, blocked, 1);
        const withoutBusy = filterAvailable(withoutBlocked, busyAppointments, service.capacity || 1);
        const now = new Date();
        const available = withoutBusy.filter((s) => s.start > now); // no ofrecer horarios que ya pasaron hoy

        res.json({
            slots: available.map((s) => ({ starts_at: s.start.toISOString(), ends_at: s.end.toISOString() })),
        });
    } catch (err) {
        console.error("services.availability error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { search, listForStore, create, getById, update, availability };
