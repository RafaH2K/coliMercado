const pool = require("../config/db");
const { sendEmail } = require("../config/email");
// WhatsApp: descomentar junto con notifyCancellationAlert() de abajo y con
// WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID en .env.
// const { sendCancellationAlert } = require("../lib/whatsappNotifications");

const STATUSES = ["pendiente", "confirmada", "cancelada", "completada", "no_asistio"];

// Fire-and-forget: un correo que falla no debe tumbar la reserva ni el
// cambio de estado, solo se loggea.
async function notifyNewAppointment({ ownerEmail, storeName, serviceName, startsAt }) {
    try {
        await sendEmail({
            to: ownerEmail,
            subject: `Nueva cita en ${storeName}`,
            html: `<p>Tienes una nueva cita: <strong>${serviceName}</strong> el ${new Date(startsAt).toLocaleString("es-MX")}.</p><p>Entra a tu panel de negocio para verla.</p>`,
        });
    } catch (err) {
        console.error("notifyNewAppointment error:", err.message);
    }
}

async function notifyAppointmentStatusChange({ customerEmail, serviceName, status }) {
    try {
        await sendEmail({
            to: customerEmail,
            subject: `Actualización de tu cita: ${serviceName}`,
            html: `<p>Tu cita de <strong>${serviceName}</strong> cambió de estado a: <strong>${status}</strong>.</p>`,
        });
    } catch (err) {
        console.error("notifyAppointmentStatusChange error:", err.message);
    }
}

// WhatsApp (Pro): aviso inmediato al dueño cuando el CLIENTE cancela.
// Descomentar junto con el require de sendCancellationAlert de arriba.
// async function notifyCancellationAlert(appointmentId) {
//     try {
//         const { rows } = await pool.query(
//             `SELECT s.phone AS store_phone, s.name AS store_name, s.timezone,
//                     pl.whatsapp_cancellation_alerts, p.name AS service_name, a.starts_at
//              FROM appointments a
//              JOIN products p ON p.id = a.product_id
//              JOIN stores s ON s.id = p.store_id
//              LEFT JOIN plans pl ON pl.id = s.plan_id
//              WHERE a.id = $1`,
//             [appointmentId]
//         );
//         const info = rows[0];
//         if (!info || !info.whatsapp_cancellation_alerts || !info.store_phone) return;
//         await sendCancellationAlert({
//             storePhone: info.store_phone,
//             storeName: info.store_name,
//             serviceName: info.service_name,
//             startsAt: info.starts_at,
//             timezone: info.timezone,
//         });
//     } catch (err) {
//         console.error("notifyCancellationAlert error:", err.message);
//     }
// }

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
            `SELECT p.id, p.name, p.duration_minutes, p.capacity, p.is_active, s.name AS store_name, u.email AS owner_email
             FROM products p JOIN stores s ON s.id = p.store_id JOIN users u ON u.id = s.owner_id
             WHERE p.id = $1 AND p.type = 'service' AND s.is_active = TRUE AND s.is_admin_approved = TRUE`,
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
        notifyNewAppointment({
            ownerEmail: service.owner_email,
            storeName: service.store_name,
            serviceName: service.name,
            startsAt: start,
        });
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
            `SELECT a.id, a.customer_id, u.email AS customer_email, s.owner_id, p.name AS service_name
             FROM appointments a
             JOIN products p ON p.id = a.product_id
             JOIN stores s ON s.id = p.store_id
             JOIN users u ON u.id = a.customer_id
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
        // Solo se notifica cuando el negocio hace el cambio: si el cliente
        // canceló su propia cita, ya lo sabe, no hace falta avisarle.
        if (isOwner) {
            notifyAppointmentStatusChange({
                customerEmail: appt.customer_email,
                serviceName: appt.service_name,
                status,
            });
        }
        // WhatsApp (Pro): descomentar junto con notifyCancellationAlert() de arriba.
        // if (status === "cancelada" && !isOwner) {
        //     notifyCancellationAlert(req.params.id);
        // }
        res.json(updated[0]);
    } catch (err) {
        console.error("appointments.updateStatus error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { create, listMine, listForStore, updateStatus };
