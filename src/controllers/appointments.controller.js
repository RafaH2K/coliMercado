const pool = require("../config/db");
const stripe = require("../config/stripe");
const { sendEmail } = require("../config/email");
// WhatsApp: descomentar junto con notifyCancellationAlert() de abajo y con
// WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID en .env.
// const { sendCancellationAlert } = require("../lib/whatsappNotifications");

const STATUSES = ["pendiente", "confirmada", "cancelada", "completada", "no_asistio"];
// Cuánto se aparta el horario mientras el cliente paga el anticipo en Stripe.
const HOLD_MINUTES = 10;

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
    let appointment;
    let requiresDeposit;
    let service;
    try {
        await client.query("BEGIN");

        const { rows: productRows } = await client.query(
            `SELECT p.id, p.name, p.duration_minutes, p.capacity, p.is_active, p.deposit_amount,
                    s.name AS store_name, u.email AS owner_email, pl.deposit_payments
             FROM products p
             JOIN stores s ON s.id = p.store_id
             JOIN users u ON u.id = s.owner_id
             LEFT JOIN plans pl ON pl.id = s.plan_id
             WHERE p.id = $1 AND p.type = 'service' AND s.is_active = TRUE AND s.is_admin_approved = TRUE`,
            [product_id]
        );
        service = productRows[0];
        if (!service || !service.is_active || !service.duration_minutes) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Servicio no encontrado" });
        }
        requiresDeposit = service.deposit_payments && Number(service.deposit_amount) > 0;

        const end = new Date(start.getTime() + service.duration_minutes * 60 * 1000);

        // Serializa reservas concurrentes del mismo servicio. El EXCLUDE
        // constraint de la tabla solo aplica cuando capacity_snapshot=1
        // (un EXCLUDE sin ese filtro bloquearía CUALQUIER traslape sin
        // importar cuántos cupos haya, rompiendo capacity>1 por completo);
        // para capacity>1 el conteo de abajo es la única protección real,
        // por eso necesita este lock.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [product_id]);

        // Un hold 'pendiente_pago' vigente (todavía no expira) también ocupa
        // el cupo: si no contara, dos clientes podrían pagar el anticipo del
        // mismo horario a la vez.
        const { rows: busyRows } = await client.query(
            `SELECT COUNT(*)::int AS count FROM appointments
             WHERE product_id = $1
               AND (status IN ('pendiente','confirmada') OR (status = 'pendiente_pago' AND hold_expires_at > NOW()))
               AND starts_at < $3 AND ends_at > $2`,
            [product_id, start, end]
        );
        if (busyRows[0].count >= (service.capacity || 1)) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Ese horario ya no está disponible" });
        }

        const status = requiresDeposit ? "pendiente_pago" : "pendiente";
        const holdExpiresAt = requiresDeposit ? new Date(Date.now() + HOLD_MINUTES * 60 * 1000) : null;

        const { rows } = await client.query(
            `INSERT INTO appointments
                (product_id, customer_id, starts_at, ends_at, notes, party_size, capacity_snapshot, status, deposit_amount, hold_expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                product_id,
                req.user.id,
                start,
                end,
                notes || null,
                party_size || null,
                service.capacity || 1,
                status,
                requiresDeposit ? service.deposit_amount : null,
                holdExpiresAt,
            ]
        );
        appointment = rows[0];

        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        if (err.code === "23P01") {
            // exclusion_violation: otra reserva ganó la carrera para este horario.
            return res.status(409).json({ error: "Ese horario ya no está disponible" });
        }
        console.error("appointments.create error:", err.message);
        return res.status(500).json({ error: "Error interno del servidor" });
    } finally {
        client.release();
    }

    if (!requiresDeposit) {
        notifyNewAppointment({
            ownerEmail: service.owner_email,
            storeName: service.store_name,
            serviceName: service.name,
            startsAt: start,
        });
        return res.status(201).json(appointment);
    }

    // Requiere anticipo: el hold ya está reservado (arriba); ahora se genera
    // el cobro. Si Stripe falla, se borra el hold para no dejar el horario
    // bloqueado 10 minutos por nada.
    try {
        const frontendUrl = process.env.CORS_ORIGIN;
        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: "mxn",
                        unit_amount: Math.round(Number(service.deposit_amount) * 100),
                        product_data: { name: `Anticipo: ${service.name}` },
                    },
                },
            ],
            metadata: { kind: "appointment_deposit", appointment_id: appointment.id },
            success_url: `${frontendUrl}/mis-citas?deposit_session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${frontendUrl}/servicios/${product_id}`,
        });
        res.status(201).json({ requires_payment: true, checkout_url: session.url, appointment_id: appointment.id });
    } catch (err) {
        await pool.query(`DELETE FROM appointments WHERE id = $1 AND status = 'pendiente_pago'`, [appointment.id]);
        console.error("appointments.create: fallo iniciando el cobro del anticipo:", err.message);
        res.status(500).json({ error: "No se pudo iniciar el cobro del anticipo" });
    }
}

// Núcleo compartido entre la confirmación que dispara el navegador y el
// webhook de Stripe (mismo patrón que fulfillStripeSession en
// orders.controller.js). Idempotente: si el hold ya no está en
// 'pendiente_pago' (ya se activó o se canceló), no hace nada.
async function activateDeposit(session) {
    const appointmentId = session.metadata?.appointment_id;
    if (!appointmentId) return;

    const { rows } = await pool.query(
        `SELECT a.id, a.product_id, a.starts_at, a.ends_at, a.status, a.capacity_snapshot, a.hold_expires_at,
                p.name AS service_name, s.name AS store_name, u.email AS owner_email
         FROM appointments a
         JOIN products p ON p.id = a.product_id
         JOIN stores s ON s.id = p.store_id
         JOIN users u ON u.id = s.owner_id
         WHERE a.id = $1`,
        [appointmentId]
    );
    const appt = rows[0];
    if (!appt || appt.status !== "pendiente_pago") return;

    // El hold ya venció: si alguien más ocupó el cupo mientras tanto, no hay
    // lugar. Reembolsa en vez de sobrevender (mismo criterio que
    // fulfillStripeSession con inventario agotado).
    if (appt.hold_expires_at && new Date(appt.hold_expires_at) < new Date()) {
        // Mismo criterio de "ocupado" que create()/availability(): un hold
        // rival todavía vigente también cuenta, no solo citas ya confirmadas.
        const { rows: busyRows } = await pool.query(
            `SELECT COUNT(*)::int AS count FROM appointments
             WHERE product_id = $1 AND id != $2
               AND (status IN ('pendiente','confirmada') OR (status = 'pendiente_pago' AND hold_expires_at > NOW()))
               AND starts_at < $4 AND ends_at > $3`,
            [appt.product_id, appt.id, appt.starts_at, appt.ends_at]
        );
        if (busyRows[0].count >= (appt.capacity_snapshot || 1)) {
            await pool.query(`UPDATE appointments SET status = 'cancelada', updated_at = NOW() WHERE id = $1`, [appt.id]);
            try {
                if (session.payment_intent) await stripe.refunds.create({ payment_intent: session.payment_intent });
            } catch (err) {
                console.error("appointments.activateDeposit: fallo el reembolso:", err.message);
            }
            return;
        }
    }

    await pool.query(
        `UPDATE appointments SET status = 'pendiente', hold_expires_at = NULL, stripe_payment_intent_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [session.payment_intent, appt.id]
    );
    notifyNewAppointment({
        ownerEmail: appt.owner_email,
        storeName: appt.store_name,
        serviceName: appt.service_name,
        startsAt: appt.starts_at,
    });
}

// El frontend llama esto al volver de Stripe para activar la cita al
// instante; el webhook (fuente confiable) la activa de todos modos si el
// cliente nunca vuelve.
async function confirmDeposit(req, res) {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: "session_id es requerido" });
    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.metadata?.kind !== "appointment_deposit") {
            return res.status(400).json({ error: "Sesión inválida" });
        }
        const { rows } = await pool.query(`SELECT customer_id FROM appointments WHERE id = $1`, [
            session.metadata.appointment_id,
        ]);
        if (!rows[0]) return res.status(404).json({ error: "Cita no encontrada" });
        if (rows[0].customer_id !== req.user.id) {
            return res.status(403).json({ error: "Esta cita no te pertenece" });
        }
        if (session.status !== "complete") {
            return res.status(402).json({ error: "El pago no se ha completado" });
        }
        await activateDeposit(session);
        const { rows: updated } = await pool.query(`SELECT * FROM appointments WHERE id = $1`, [
            session.metadata.appointment_id,
        ]);
        res.json(updated[0]);
    } catch (err) {
        console.error("appointments.confirmDeposit error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function listMine(req, res) {
    try {
        const { rows } = await pool.query(
            `SELECT a.*, p.name AS service_name, p.store_id, s.timezone AS store_timezone
             FROM appointments a
             JOIN products p ON p.id = a.product_id
             JOIN stores s ON s.id = p.store_id
             WHERE a.customer_id = $1 AND a.status != 'pendiente_pago'
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
             WHERE p.store_id = $1 AND a.status != 'pendiente_pago'
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
            `SELECT a.id, a.customer_id, a.stripe_payment_intent_id, u.email AS customer_email, s.owner_id, p.name AS service_name
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

        // Anticipo pagado + cancelación (por cualquiera de las dos partes) =
        // reembolso automático, como se pidió.
        if (status === "cancelada" && appt.stripe_payment_intent_id) {
            try {
                await stripe.refunds.create({ payment_intent: appt.stripe_payment_intent_id });
            } catch (err) {
                console.error("appointments.updateStatus: fallo el reembolso del anticipo:", err.message);
            }
        }

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

module.exports = { create, listMine, listForStore, updateStatus, confirmDeposit, activateDeposit };
