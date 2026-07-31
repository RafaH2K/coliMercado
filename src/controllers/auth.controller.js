const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SALT_ROUNDS = 12;
// Hash "de relleno" para comparar contra él cuando el email no existe,
// así el tiempo de respuesta no delata si un email está registrado.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeOOAtI9v.mHqDaQhP8Zr6zQe1mA1z8G3q";

function signToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

async function register(req, res) {
    const { name, email, phone, password } = req.body;

    if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "Email inválido" });
    }
    if (!password || password.length < 8) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    }

    try {
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        const { rows } = await pool.query(
            `INSERT INTO users (name, email, phone, password_hash)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, email, phone, is_admin, created_at`,
            [name || null, email, phone || null, password_hash]
        );
        const user = rows[0];
        res.status(201).json({ user, token: signToken(user.id) });
    } catch (err) {
        if (err.code === "23505") {
            return res.status(409).json({ error: "Ese email ya está registrado" });
        }
        console.error("register error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function login(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email y contraseña son requeridos" });
    }

    try {
        const { rows } = await pool.query(
            `SELECT id, name, email, phone, is_admin, password_hash FROM users WHERE email = $1`,
            [email]
        );
        const user = rows[0];
        const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
        if (!user || !match) {
            return res.status(401).json({ error: "Credenciales inválidas" });
        }
        delete user.password_hash;
        res.json({ user, token: signToken(user.id) });
    } catch (err) {
        console.error("login error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { register, login };
