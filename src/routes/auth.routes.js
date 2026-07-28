const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { register, login } = require("../controllers/auth.controller");

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

module.exports = router;
