const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const cart = require("../controllers/cart.controller");

const router = Router();

router.use(requireAuth);
router.get("/", cart.list);
router.post("/", cart.add);
router.patch("/:productId", cart.updateQuantity);
router.delete("/:productId", cart.remove);

module.exports = router;
