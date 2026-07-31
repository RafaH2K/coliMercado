const pool = require("../config/db");

const STATUSES = ["pendiente", "confirmada", "cancelada", "completada", "no_asistio"];

async function create(req, res) {
    const { product_id, starts_at, notes, party_size } = req.body;
    if (!product_id || !starts_at) {
        return res.status(400).json({ error: "product_id y starts_at son requeridos" });
    }
    const start = new Date(starts_at);
    if (Number.isNaN(start.getTime()) || start <= new Date()) {
        return res.status(400).json({ error: "starts_at debe ser una fecha válida en el futuro" });
    }
    if (party_size !== undefined && party_size !== null && (!Number.isInteger(party_size) || party_size < 1)) {
        return res.status(400).json({ error: "party_size debe ser un entero positivo" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const { rows: productRows } = await client.query(
            `SELECT id, duration_minutes, capacity, is_active FROM products
             WHERE id = $1 AND type = 'service'`,
            [product_id]
        );
        const service = productRows[0];
        if (!service || !service.is_active || !service.duration_minutes) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Servicio no encontrado" });
        }

        const end = new Date(start.getTime() + service.duration_minutes * 60 * 1000);

        // Serializa reservas concurrentes del mismo servicio. El EXCLUDE
        // constraint de la tabla solo aplica cuando capacity_snapshot=1
        // (un EXCLUDE sin ese filtro bloquearía CUALQUIER traslape sin
        // importar cuántos cupos haya, rompiendo capacity>1 por completo);
        // para capacity>1 el conteo de abajo es la única protección real,
        // por eso necesita este lock.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [product_id]);

        const { rows: busyRows } = await client.query(
            `SELECT COUNT(*)::int AS count FROM appointments
             WHERE product_id = $1 AND status IN ('pendiente','confirmada')
               AND starts_at < $3 AND ends_at > $2`,
            [product_id, start, end]
        );
        if (busyRows[0].count >= (service.capacity || 1)) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Ese horario ya no está disponible" });
        }

        const { rows } = await client.query(
            `INSERT INTO appointments (product_id, customer_id, starts_at, ends_at, notes, party_size, capacity_snapshot)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [product_id, req.user.id, start, end, notes || null, party_size || null, service.capacity || 1]
        );

        await client.query("COMMIT");
        res.status(201).json(rows[0]);
    } catch (err) {
        await client.query("ROLLBACK");
        if (err.code === "23P01") {
            // exclusion_violation: otra reserva ganó la carrera para este horario.
            return res.status(409).json({ error: "Ese horario ya no está disponible" });
        }
        console.error("appointments.create error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    } finally {
        client.release();
    }
}

async function listMine(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT a.*, p.name AS service_name, p.store_id, s.timezone AS store_timezone
             FROM appointments a
             JOIN products p ON p.id = a.product_id
             JOIN stores s ON s.id = p.store_id
             WHERE a.customer_id = $1
             ORDER BY a.starts_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error("appointments.listMine error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function listForStore(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT a.*, p.name AS service_name, u.name AS customer_name, u.email AS customer_email,
                    s.timezone AS store_timezone
             FROM appointments a
             JOIN products p ON p.id = a.product_id
             JOIN users u ON u.id = a.customer_id
             JOIN stores s ON s.id = p.store_id
             WHERE p.store_id = $1
             ORDER BY a.starts_at DESC`,
            [req.store.id]
        );
        res.json(rows);
    } catch (err) {
        console.error("appointments.listForStore error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function updateStatus(req, res) {
    const { status } = req.body;
    if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: `status debe ser uno de: ${STATUSES.join(", ")}` });
    }

    try {
        const { rows } = await pool.query(
            `SELECT a.id, a.customer_id, s.owner_id
             FROM appointments a
             JOIN products p ON p.id = a.product_id
             JOIN stores s ON s.id = p.store_id
             WHERE a.id = $1`,
            [req.params.id]
        );
        const appt = rows[0];
        if (!appt) return res.status(404).json({ error: "Cita no encontrada" });

        const isOwner = appt.owner_id === req.user.id;
        const isCustomer = appt.customer_id === req.user.id;
        // El dueño del negocio puede poner cualquier estado; el cliente solo puede cancelar la suya.
        if (!isOwner && !(isCustomer && status === "cancelada")) {
            return res.status(403).json({ error: "No autorizado para hacer este cambio" });
        }

        const { rows: updated } = await pool.query(
            `UPDATE appointments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [status, req.params.id]
        );
        res.json(updated[0]);
    } catch (err) {
        console.error("appointments.updateStatus error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { create, listMine, listForStore, updateStatus };
