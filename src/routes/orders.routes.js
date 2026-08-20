const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const requireAuth = require("../middlewares/auth");
const orders = require("../controllers/orders.controller");
const messages = require("../controllers/messages.controller");

const router = Router();

// Limita intentos de checkout/pago: cada uno mueve dinero o llama a la API
// de Mercado Pago, así que no deben poder martillarse igual que un GET cualquiera.
const checkoutLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

// Sin esto, cualquiera de las dos partes de un chat podía mandar mensajes
// sin límite (spam/acoso hacia la otra).
const messageLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
});

router.use(requireAuth);
router.post("/", checkoutLimiter, orders.checkout);
router.post("/mercadopago/checkout-session", checkoutLimiter, orders.createMercadoPagoCheckoutSession);
router.post("/mercadopago/confirm", checkoutLimiter, orders.confirmMercadoPagoPayment);
router.get("/me", orders.listMine);
router.patch("/:id/status", orders.updateStatus);
router.get("/:id/messages", messages.listForOrder);
router.post("/:id/messages", messageLimiter, messages.createForOrder);

module.exports = router;
