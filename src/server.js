require("dotenv").config();
const app = require("./app.js");
const { start: startDailySummaryScheduler } = require("./jobs/dailySummaryScheduler");
// El resumen diario se manda por correo mientras no haya credenciales reales
// de WhatsApp (Meta); ver src/lib/whatsappNotifications.js para el aviso de
// cancelación, que sigue pendiente de esas credenciales.

const port = process.env.PORT || 3000;
app.listen(port);
startDailySummaryScheduler();
console.log(`Servidor corriendo en el puerto ${port}`);
