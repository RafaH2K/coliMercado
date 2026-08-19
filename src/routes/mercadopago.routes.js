const { Router } = require("express");
const mercadopago = require("../controllers/mercadopago.controller");

const router = Router();

// Pública a propósito: Mercado Pago redirige aquí directo desde el navegador
// del dueño del negocio, no puede mandar Authorization header. La seguridad
// depende del state firmado que se verifica en el controller.
router.get("/callback", mercadopago.callback);

// Pública a propósito: Mercado Pago llama aquí server-to-server para avisar
// de un pago (carrito o anticipo de cita). La autenticidad se verifica con
// la firma HMAC (ver mercadopago.controller.js#webhook), no con requireAuth.
router.post("/webhook", mercadopago.webhook);

module.exports = router;
