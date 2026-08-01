const pool = require("../config/db");
const dailySummaryEmail = require("../lib/dailySummaryEmail");

// Revisa cada minuto qué negocios tienen su whatsapp_summary_time
// configurado y coincide con la hora actual EN SU zona horaria, y cuyo plan
// incluye whatsapp_daily_summary (Básico y Pro). Por ahora manda el resumen
// por correo al dueño; cuando haya credenciales reales de WhatsApp (Meta)
// esto puede volver a mandarse por ahí (ver src/lib/whatsappNotifications.js).
// ponytail: comparación por minuto exacto vía polling, sin cola ni
// reintento — si el proceso está caído justo en ese minuto, ese negocio se
// salta el resumen del día. Subir a una cola con reintento si esto se vuelve
// crítico para el negocio.
async function tick() {
    try {
        const { rows: stores } = await pool.query(
            `SELECT s.id, s.name, s.timezone, s.whatsapp_summary_time, s.whatsapp_summary_mode, u.email AS owner_email
             FROM stores s
             JOIN plans pl ON pl.id = s.plan_id
             JOIN users u ON u.id = s.owner_id
             WHERE s.is_active = TRUE AND s.is_admin_approved = TRUE
               AND pl.whatsapp_daily_summary = TRUE
               AND s.whatsapp_summary_time IS NOT NULL`
        );

        for (const store of stores) {
            const nowInStoreTz = new Intl.DateTimeFormat("en-GB", {
                timeZone: store.timezone,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            }).format(new Date());
            const targetTime = store.whatsapp_summary_time.slice(0, 5); // "HH:MM:SS" -> "HH:MM"

            if (nowInStoreTz === targetTime) {
                dailySummaryEmail.sendDailySummaryEmail(store).catch((err) =>
                    console.error(`dailySummaryScheduler sendDailySummaryEmail(${store.id}) error:`, err.message)
                );
            }
        }
    } catch (err) {
        console.error("dailySummaryScheduler tick error:", err.message);
    }
}

function start() {
    setInterval(tick, 60 * 1000);
}

module.exports = { start, tick };
