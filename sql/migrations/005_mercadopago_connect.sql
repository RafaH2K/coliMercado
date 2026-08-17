-- Migración incremental: cada negocio conecta su propia cuenta de Mercado
-- Pago (OAuth) para recibir directamente sus pagos, en vez de que todo caiga
-- a la cuenta de Stripe de la plataforma. Aplica sobre el esquema actual.

BEGIN;

-- access_token/refresh_token se guardan cifrados (ver src/lib/crypto.js) —
-- son las llaves para mover el dinero de cada negocio.
ALTER TABLE stores
    ADD COLUMN mercadopago_user_id BIGINT,
    ADD COLUMN mercadopago_access_token TEXT,
    ADD COLUMN mercadopago_refresh_token TEXT,
    ADD COLUMN mercadopago_public_key TEXT,
    ADD COLUMN mercadopago_token_expires_at TIMESTAMPTZ;

COMMIT;
