const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { frontendUrl } = require("../lib/frontendUrl");
const { encrypt } = require("../lib/crypto");
const mercadopago = require("../lib/mercadopago");
const orders = require("./orders.controller");
const appointments = require("./appointments.controller");

const AUTH_URL = "https://auth.mercadopago.com/authorization";
const TOKEN_URL = "https://api.mercadopago.com/oauth/token";

// El dueño del negocio inicia la conexión: firma un state de corta duración
// (como el code de Mercado Pago, válido 10 min) para no necesitar guardar un
// nonce aparte — la seguridad del callback público depende enteramente de
// este JWT.
async function connect(req, res) {
    if (!process.env.MERCADOPAGO_CLIENT_ID || !process.env.MERCADOPAGO_REDIRECT_URI) {
        return res.status(500).json({ error: "Mercado Pago no está configurado en el servidor" });
    }
    const state = jwt.sign({ storeId: req.store.id }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const url =
        `${AUTH_URL}?client_id=${encodeURIComponent(process.env.MERCADOPAGO_CLIENT_ID)}` +
        `&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}` +
        `&redirect_uri=${encodeURIComponent(process.env.MERCADOPAGO_REDIRECT_URI)}`;
    res.json({ url });
}

// Mercado Pago redirige aquí directo (navegación completa del navegador, sin
// poder mandar Authorization header) — nunca requireAuth, la identidad del
// negocio sale únicamente de verificar el `state` firmado arriba.
async function callback(req, res) {
    const { code, state, error } = req.query;
    if (error || !code || !state) {
        return res.redirect(`${frontendUrl()}/mi-negocio?mercadopago=error`);
    }
    try {
        const { storeId } = jwt.verify(state, process.env.JWT_SECRET);

        const tokenRes = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: process.env.MERCADOPAGO_CLIENT_ID,
                client_secret: process.env.MERCADOPAGO_CLIENT_SECRET,
                grant_type: "authorization_code",
                code,
                redirect_uri: process.env.MERCADOPAGO_REDIRECT_URI,
            }),
        });
        if (!tokenRes.ok) throw new Error(`Mercado Pago respondió ${tokenRes.status}`);
        const data = await tokenRes.json();

        await pool.query(
            `UPDATE stores SET
                mercadopago_user_id = $1,
                mercadopago_access_token = $2,
                mercadopago_refresh_token = $3,
                mercadopago_public_key = $4,
                mercadopago_token_expires_at = NOW() + ($5 || ' seconds')::interval
             WHERE id = $6`,
            [data.user_id, encrypt(data.access_token), encrypt(data.refresh_token), data.public_key, data.expires_in, storeId]
        );
        res.redirect(`${frontendUrl()}/mi-negocio?mercadopago=connected`);
    } catch (err) {
        console.error("mercadopago.callback error:", err.message);
        res.redirect(`${frontendUrl()}/mi-negocio?mercadopago=error`);
    }
}

async function status(req, res) {
    try {
        const { rows } = await pool.query(`SELECT mercadopago_user_id FROM stores WHERE id = $1`, [req.store.id]);
        res.json({ connected: !!rows[0]?.mercadopago_user_id });
    } catch (err) {
        console.error("mercadopago.status error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

async function disconnect(req, res) {
    try {
        await pool.query(
            `UPDATE stores SET
                mercadopago_user_id = NULL,
                mercadopago_access_token = NULL,
                mercadopago_refresh_token = NULL,
                mercadopago_public_key = NULL,
                mercadopago_token_expires_at = NULL
             WHERE id = $1`,
            [req.store.id]
        );
        res.status(204).send();
    } catch (err) {
        console.error("mercadopago.disconnect error:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
}

// Fuente de verdad de los pagos con tarjeta (carrito y anticipos de citas):
// Mercado Pago llama aquí server-to-server, así que el pedido/cita se
// confirma aunque el cliente nunca vuelva a la página de éxito. Pública a
// propósito (MP no manda Authorization header) -- la autenticidad se
// verifica con la firma HMAC, no con requireAuth.
async function webhook(req, res) {
    // Notificaciones nuevas mandan el id en el body; las IPN viejas, en la
    // query -- se revisan ambas por si la app quedó configurada con el
    // formato antiguo.
    const dataId = req.body?.data?.id || req.query["data.id"] || req.query.id;
    const type = req.body?.type || req.query.type || req.query.topic;

    const validSignature = mercadopago.verifyWebhookSignature({
        xSignature: req.headers["x-signature"],
        xRequestId: req.headers["x-request-id"],
        dataId,
        secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    });
    if (!validSignature) {
        console.error("mercadopago.webhook: firma inválida");
        return res.status(401).json({ error: "Firma inválida" });
    }
    if (type !== "payment" || !dataId) {
        // Otros tipos de evento (ej. merchant_order) no nos interesan.
        return res.json({ received: true });
    }

    try {
        // Se usa el access_token de la propia plataforma para consultar el
        // pago -- el webhook solo trae el id, no de qué negocio es; hace
        // falta consultarlo para saber a qué flujo (pedido o anticipo de
        // cita) enrutarlo, vía external_reference.
        const payment = await mercadopago.getPayment({
            accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
            paymentId: dataId,
        });
        const [kind, a, b] = String(payment.external_reference || "").split(":");
        if (kind === "order") {
            await orders.fulfillMercadoPagoPayment({ payment, userId: a, storeId: b });
        } else if (kind === "appointment") {
            await appointments.activateMercadoPagoDeposit(payment);
        }
    } catch (err) {
        // Ya se hizo lo posible (incl. el reembolso si aplicaba); solo se
        // deja registro. Se responde 200 igual para que MP no reintente
        // indefinidamente algo que un reintento no va a arreglar.
        console.error("mercadopago.webhook: fulfillment error:", err.message);
    }
    res.json({ received: true });
}

module.exports = { connect, callback, status, disconnect, webhook };
