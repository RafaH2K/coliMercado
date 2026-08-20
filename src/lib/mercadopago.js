const crypto = require("crypto");

// Cliente delgado sobre la API REST de Mercado Pago (fetch nativo, mismo
// patrón que ya usa mercadopago.controller.js para el intercambio OAuth) --
// no hay SDK oficial de Node ya instalado en el proyecto, y no hace falta
// uno para 4 llamadas HTTP.
const API_BASE = "https://api.mercadopago.com";

class MercadoPagoError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

async function request(path, { accessToken, method = "GET", body } = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        throw new MercadoPagoError(data?.message || `Mercado Pago respondió ${res.status}`, res.status);
    }
    return data;
}

// Crea una preferencia de pago (Checkout Pro) a nombre del negocio dueño de
// accessToken -- el dinero cae directo a SU cuenta de Mercado Pago.
// marketplaceFee es lo que se descuenta para la plataforma (0 = nada).
async function createPreference({ accessToken, items, marketplaceFee, backUrls, notificationUrl, externalReference }) {
    return request("/checkout/preferences", {
        accessToken,
        method: "POST",
        body: {
            items,
            marketplace_fee: marketplaceFee,
            back_urls: backUrls,
            auto_return: "approved",
            notification_url: notificationUrl,
            external_reference: externalReference,
        },
    });
}

async function getPayment({ accessToken, paymentId }) {
    return request(`/v1/payments/${paymentId}`, { accessToken });
}

async function refundPayment({ accessToken, paymentId }) {
    return request(`/v1/payments/${paymentId}/refunds`, { accessToken, method: "POST" });
}

// Renueva un access_token por vencer usando su refresh_token. Requiere que
// el permiso original se haya pedido con scope=offline_access (ver
// mercadopago.controller.js#connect) -- sin eso, Mercado Pago rechaza esta
// llamada aunque haya guardado un refresh_token. MP rota el refresh_token
// en cada renovación: el que devuelve esta llamada hay que volver a
// guardarlo, el anterior deja de servir.
async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
    const res = await fetch(`${API_BASE}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        throw new MercadoPagoError(data?.message || `Mercado Pago respondió ${res.status}`, res.status);
    }
    return data;
}

// Firma HMAC-SHA256 de los webhooks: manifest "id:{dataId};request-id:{requestId};ts:{ts};"
// (dataId siempre en minúsculas). x-signature llega como "ts=...,v1=...".
// https://www.mercadopago.com.mx/developers/en/docs/checkout-api/additional-content/your-integrations/notifications/webhooks
function verifyWebhookSignature({ xSignature, xRequestId, dataId, secret }) {
    if (!xSignature || !dataId || !secret) return false;
    const parts = Object.fromEntries(
        xSignature.split(",").map((p) => {
            const [k, v] = p.split("=");
            return [k?.trim(), v?.trim()];
        })
    );
    const { ts, v1 } = parts;
    if (!ts || !v1) return false;

    const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId || ""};ts:${ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
    MercadoPagoError,
    createPreference,
    getPayment,
    refundPayment,
    refreshAccessToken,
    verifyWebhookSignature,
};
