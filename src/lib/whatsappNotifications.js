const pool = require("../config/db");
const { sendWhatsApp } = require("../config/whatsapp");
const { zonedTimeToUtc, addDays } = require("./timezone");

function todayInZone(timeZone) {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()); // en-CA => "YYYY-MM-DD"
}

// Resumen diario de citas/reservaciones de un negocio (Básico y Pro).
// whatsapp_summary_mode 'noche_anterior' (solo Pro) manda el resumen de
// MAÑANA en vez de hoy, para que el dueño se planifique un día antes.
async function sendDailySummary(store) {
    const today = todayInZone(store.timezone);
    const targetDate = store.whatsapp_summary_mode === "noche_anterior" ? addDays(today, 1) : today;

    const dayStart = zonedTimeToUtc(targetDate, "00:00:00", store.timezone);
    const dayEnd = zonedTimeToUtc(addDays(targetDate, 1), "00:00:00", store.timezone);

    const { rows } = await pool.query(
        `SELECT a.starts_at, p.name AS service_name, u.name AS customer_name
         FROM appointments a
         JOIN products p ON p.id = a.product_id
         JOIN users u ON u.id = a.customer_id
         WHERE p.store_id = $1 AND a.status IN ('pendiente','confirmada')
           AND a.starts_at >= $2 AND a.starts_at < $3
         ORDER BY a.starts_at ASC`,
        [store.id, dayStart, dayEnd]
    );

    const label = targetDate === today ? "hoy" : "mañana";
    const lines = rows.length
        ? rows
              .map((a) => {
                  const time = new Date(a.starts_at).toLocaleTimeString("es-MX", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: store.timezone,
                  });
                  return `• ${time} - ${a.service_name} (${a.customer_name || "cliente"})`;
              })
              .join("\n")
        : "Sin citas/reservaciones.";

    await sendWhatsApp({
        to: store.phone,
        body: `Resumen de citas para ${label} en ${store.name}:\n\n${lines}`,
    });
}

// Aviso inmediato al dueño cuando el CLIENTE cancela una cita (solo Pro).
async function sendCancellationAlert({ storePhone, storeName, serviceName, startsAt, timezone }) {
    const when = new Date(startsAt).toLocaleString("es-MX", { timeZone: timezone });
    await sendWhatsApp({
        to: storePhone,
        body: `Cancelación en ${storeName}: "${serviceName}" del ${when} fue cancelada por el cliente.`,
    });
}

module.exports = { sendDailySummary, sendCancellationAlert };
