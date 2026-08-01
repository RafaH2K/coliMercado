const pool = require("../config/db");
const email = require("../config/email");
const { zonedTimeToUtc, addDays } = require("./timezone");

function todayInZone(timeZone) {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()); // en-CA => "YYYY-MM-DD"
}

// Resumen diario de citas/reservaciones de un negocio (Básico y Pro). Por
// ahora se manda por correo al dueño (no requiere credenciales de WhatsApp);
// cuando haya credenciales reales de Meta esto puede volver a mandarse por
// WhatsApp (ver src/lib/whatsappNotifications.js).
// whatsapp_summary_mode 'noche_anterior' (solo Pro) manda el resumen de
// MAÑANA en vez de hoy, para que el dueño se planifique un día antes.
async function sendDailySummaryEmail(store) {
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
    const itemsHtml = rows.length
        ? `<ul>${rows
              .map((a) => {
                  const time = new Date(a.starts_at).toLocaleTimeString("es-MX", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: store.timezone,
                  });
                  return `<li>${time} - ${a.service_name} (${a.customer_name || "cliente"})</li>`;
              })
              .join("")}</ul>`
        : "<p>Sin citas/reservaciones.</p>";

    await email.sendEmail({
        to: store.owner_email,
        subject: `Resumen de citas para ${label} en ${store.name}`,
        html: `<p>Resumen de citas para <strong>${label}</strong> en ${store.name}:</p>${itemsHtml}`,
    });
}

module.exports = { sendDailySummaryEmail };
