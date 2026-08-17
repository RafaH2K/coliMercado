const crypto = require("crypto");

// Cifra los tokens de Mercado Pago en reposo (AES-256-GCM, crypto nativo de
// Node) — son las llaves para mover el dinero de cada negocio conectado, no
// deben quedar en texto plano en un dump de la base de datos.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado para GCM

function getKey() {
    const key = process.env.MERCADOPAGO_TOKEN_KEY;
    if (!key) throw new Error("MERCADOPAGO_TOKEN_KEY no está definida (revisa tu .env)");
    const buf = Buffer.from(key, "base64");
    if (buf.length !== 32) throw new Error("MERCADOPAGO_TOKEN_KEY debe ser 32 bytes en base64");
    return buf;
}

// Formato: iv:authTag:ciphertext, todo en base64, unido por ":".
function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

function decrypt(payload) {
    const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
}

module.exports = { encrypt, decrypt };
