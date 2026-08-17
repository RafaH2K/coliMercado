const { Router } = require("express");
const mercadopago = require("../controllers/mercadopago.controller");

const router = Router();

// Pública a propósito: Mercado Pago redirige aquí directo desde el navegador
// del dueño del negocio, no puede mandar Authorization header. La seguridad
// depende del state firmado que se verifica en el controller.
router.get("/callback", mercadopago.callback);

module.exports = router;
