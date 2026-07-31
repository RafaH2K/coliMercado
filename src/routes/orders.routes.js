const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const orders = require("../controllers/orders.controller");

const router = Router();

router.use(requireAuth);
router.post("/", orders.checkout);
router.post("/checkout-session", orders.createCheckoutSession);
router.post("/confirm", orders.confirmStripeSession);
router.get("/me", orders.listMine);
router.patch("/:id/status", orders.updateStatus);

module.exports = router;
