const pool = require("../config/db");
const mercadopago = require("../lib/mercadopago");
const { encrypt, decrypt } = require("../lib/crypto");

// El access_token de Mercado Pago vence a los 180 días. Se renueva con
// bastante margen (no al filo) para tener varios días de reintento si el
// proceso está caído, o si Mercado Pago falla, antes de que el token de
// verdad deje de servir y el negocio no pueda cobrar.
const REFRESH_BEFORE_DAYS = 15;

async function tick() {
    try {
        const { rows: stores } = await pool.query(
            `SELECT id, name, mercadopago_refresh_token FROM stores
             WHERE mercadopago_refresh_token IS NOT NULL
               AND mercadopago_token_expires_at < NOW() + ($1 || ' days')::interval`,
            [REFRESH_BEFORE_DAYS]
        );

        for (const store of stores) {
            try {
                const data = await mercadopago.refreshAccessToken({
                    clientId: process.env.MERCADOPAGO_CLIENT_ID,
                    clientSecret: process.env.MERCADOPAGO_CLIENT_SECRET,
                    refreshToken: decrypt(store.mercadopago_refresh_token),
                });
                // Mercado Pago rota el refresh_token en cada renovación: el
                // guardado aquí es el único que va a servir la próxima vez.
                await pool.query(
                    `UPDATE stores SET
                        mercadopago_access_token = $1,
                        mercadopago_refresh_token = $2,
                        mercadopago_token_expires_at = NOW() + ($3 || ' seconds')::interval
                     WHERE id = $4`,
                    [encrypt(data.access_token), encrypt(data.refresh_token), data.expires_in, store.id]
                );
            } catch (err) {
                // Si el refresh_token ya no sirve (ej. una conexión hecha
                // antes de pedir scope=offline_access, o revocada desde
                // Mercado Pago), no hay forma automática de repararlo -- el
                // negocio va a necesitar desconectar y reconectar a mano.
                // Se deja registro por negocio, no se detiene el resto.
                console.error(
                    `mercadopagoTokenRefresh: fallo renovando el token de "${store.name}" (${store.id}):`,
                    err.message
                );
            }
        }
    } catch (err) {
        // err completo, no solo .message: fallas de red de bajo nivel (ej.
        // AggregateError por IPv6 no soportado) suelen traer .message vacío.
        console.error("mercadopagoTokenRefresh tick error:", err);
    }
}

function start() {
    // Corre una vez al arrancar (no esperar 24h para el primer chequeo tras
    // un deploy) y luego una vez al día -- de sobra para un margen de 15 días.
    tick();
    setInterval(tick, 24 * 60 * 60 * 1000);
}

module.exports = { start, tick };
