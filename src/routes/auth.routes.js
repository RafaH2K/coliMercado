const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const requireAuth = require("../middlewares/auth");
const { register, login, forgotPassword, resetPassword, deleteAccount } = require("../controllers/auth.controller");

const router = Router();

// Limita fuerza bruta en login/registro sin frenar el resto de la API.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.delete("/me", requireAuth, deleteAccount);

module.exports = router;
