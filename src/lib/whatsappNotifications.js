const { sendWhatsApp } = require("../config/whatsapp");

// Aviso inmediato al dueño cuando el CLIENTE cancela una cita (solo Pro).
// Sigue pendiente de credenciales reales de Meta (ver appointments.controller.js).
async function sendCancellationAlert({ storePhone, storeName, serviceName, startsAt, timezone }) {
    const when = new Date(startsAt).toLocaleString("es-MX", { timeZone: timezone });
    await sendWhatsApp({
        to: storePhone,
        body: `Cancelación en ${storeName}: "${serviceName}" del ${when} fue cancelada por el cliente.`,
    });
}

module.exports = { sendCancellationAlert };
