const { Resend } = require("resend");

if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY no está definida (revisa tu .env)");
}

const resend = new Resend(process.env.RESEND_API_KEY);

// onboarding@resend.dev funciona sin verificar un dominio propio; útil para
// dev/pruebas. Cuando haya un dominio verificado en Resend, cambiar esto por
// algo como notificaciones@colimamerrcado.com.
const FROM = "colimaMerrcado <onboarding@resend.dev>";

async function sendEmail({ to, subject, html }) {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) throw new Error(error.message || "No se pudo enviar el correo");
}

module.exports = { sendEmail };
