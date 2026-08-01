const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/db");
const { sendEmail } = require("../config/email");
const { frontendUrl } = require("../lib/frontendUrl");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SALT_ROUNDS = 12;
// Hash "de relleno" para comparar contra él cuando el email no existe,
// así el tiempo de respuesta no delata si un email está registrado.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeOOAtI9v.mHqDaQhP8Zr6zQe1mA1z8G3q";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

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

// Siempre responde el mismo mensaje genérico (exista o no el email, falle o
// no el envío) para no delatar por timing/contenido qué correos están
// registrados. Los errores reales quedan solo en el log del servidor.
async function forgotPassword(req, res) {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email es requerido" });

    const genericOk = () =>
        res.json({ message: "Si el email está registrado, te enviamos instrucciones para restablecer tu contraseña." });

    try {
        const { rows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
        const user = rows[0];
        if (!user) return genericOk();

        const token = crypto.randomBytes(32).toString("hex");
        await pool.query(`UPDATE users SET reset_token_hash = $1, reset_token_expires = $2 WHERE id = $3`, [
            hashToken(token),
            new Date(Date.now() + RESET_TOKEN_TTL_MS),
            user.id,
        ]);

        const resetUrl = `${frontendUrl()}/restablecer-password?token=${token}`;
        await sendEmail({
            to: email,
            subject: "Restablece tu contraseña en colimaMerrcado",
            html: `
                <p>Solicitaste restablecer tu contraseña en colimaMerrcado.</p>
                <p><a href="${resetUrl}">Haz clic aquí para crear una nueva contraseña</a></p>
                <p>Este enlace expira en 1 hora. Si tú no lo solicitaste, ignora este correo.</p>
            `,
        });
        genericOk();
    } catch (err) {
        console.error("forgotPassword error:", err.message);
        genericOk();
    }
}

async function resetPassword(req, res) {
    const { token, password } = req.body;
    if (!token || !password) {
        return res.status(400).json({ error: "token y password son requeridos" });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    }

    try {
        const { rows } = await pool.query(
            `SELECT id FROM users WHERE reset_token_hash = $1 AND reset_token_expires > NOW()`,
            [hashToken(token)]
        );
        const user = rows[0];
        if (!user) return res.status(400).json({ error: "El enlace es inválido o ya expiró" });

        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        await pool.query(
            `UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2`,
            [password_hash, user.id]
        );
        res.json({ message: "Contraseña actualizada correctamente" });
    } catch (err) {
        console.error("resetPassword error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

module.exports = { register, login, forgotPassword, resetPassword };
