const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const requireAuth = require("../middlewares/auth");
const appointments = require("../controllers/appointments.controller");
const messages = require("../controllers/messages.controller");

const router = Router();

// Reservar toma un advisory lock, puede llamar a la API de Mercado Pago y
// manda un correo -- mismo criterio y mismos números que checkoutLimiter en
// orders.routes.js.
const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

// Aparte del de arriba: sin esto, cualquiera de las dos partes de un chat
// podía mandar mensajes sin límite (spam/acoso hacia la otra).
const messageLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
});

router.post("/", requireAuth, bookingLimiter, appointments.create);
router.post("/mercadopago/deposit/confirm", requireAuth, bookingLimiter, appointments.confirmMercadoPagoDeposit);
router.get("/me", requireAuth, appointments.listMine);
router.patch("/:id/status", requireAuth, appointments.updateStatus);
router.get("/:id/messages", requireAuth, messages.listForAppointment);
router.post("/:id/messages", requireAuth, messageLimiter, messages.createForAppointment);

module.exports = router;
