// Cliente mínimo para la API de WhatsApp Cloud (Meta), sin SDK: es un solo
// POST con fetch (nativo en Node 20). Requiere WHATSAPP_TOKEN y
// WHATSAPP_PHONE_NUMBER_ID en .env (ver developers.facebook.com > tu app >
// WhatsApp > API Setup).
if (!process.env.WHATSAPP_TOKEN) {
    throw new Error("WHATSAPP_TOKEN no está definida (revisa tu .env)");
}
if (!process.env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID no está definida (revisa tu .env)");
}

const GRAPH_URL = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

// ponytail: manda mensaje de texto libre, que Meta solo entrega dentro de una
// ventana de 24h posterior a un mensaje del destinatario. Para notificar sin
// que el negocio haya escrito antes (el caso real aquí) hace falta una
// plantilla aprobada por Meta — cambiar type:"text" por type:"template" con
// el nombre/params de esa plantilla en cuanto esté aprobada.
async function sendWhatsApp({ to, body }) {
    const res = await fetch(GRAPH_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body },
        }),
    });
    if (!res.ok) {
        throw new Error(`WhatsApp API error ${res.status}: ${await res.text()}`);
    }
}

module.exports = { sendWhatsApp };
