-- Migración incremental: soporte de cobro real (Stripe Subscriptions) para
-- planes de pago. Aplica sobre el esquema actual (post "Agrega chat...").

BEGIN;

ALTER TABLE stores
    ADD COLUMN stripe_customer_id TEXT,
    ADD COLUMN stripe_subscription_id TEXT UNIQUE;

COMMIT;
