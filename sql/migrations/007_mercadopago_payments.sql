-- Migración incremental: checkout real vía Mercado Pago (split payment) para
-- carrito de productos y anticipos de citas. El dinero cae directo a la
-- cuenta conectada del negocio (ver 005_mercadopago_connect.sql); estas
-- columnas guardan la referencia del pago, mismo rol que sus equivalentes
-- de Stripe (stripe_session_id / stripe_payment_intent_id).

BEGIN;

ALTER TABLE payments ADD COLUMN mercadopago_payment_id TEXT UNIQUE;
ALTER TABLE appointments ADD COLUMN mercadopago_payment_id TEXT;

COMMIT;
