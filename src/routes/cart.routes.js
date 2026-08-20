const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const requireAuth = require("../middlewares/auth");
const cart = require("../controllers/cart.controller");

const router = Router();

// Riesgo bajo (solo escribe en el carrito del propio usuario), pero sin
// límite nada impedía martillar el endpoint en un loop.
const cartWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
});

router.use(requireAuth);
router.get("/", cart.list);
router.post("/", cartWriteLimiter, cart.add);
router.patch("/:productId", cartWriteLimiter, cart.updateQuantity);
router.delete("/:productId", cartWriteLimiter, cart.remove);

module.exports = router;
