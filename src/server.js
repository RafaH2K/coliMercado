require("dotenv").config();
const app = require("./app.js");
// WhatsApp: descomentar junto con WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID en
// .env cuando haya credenciales reales de Meta (ver src/jobs/whatsappScheduler.js).
// const { start: startWhatsappScheduler } = require("./jobs/whatsappScheduler");

const port = process.env.PORT || 3000;
app.listen(port);
// startWhatsappScheduler();
console.log(`Servidor corriendo en el puerto ${port}`);
