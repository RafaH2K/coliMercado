-- Migración incremental: anticipo (Pro) para reservar citas/servicios.
-- Aplica sobre el esquema actual (post "cobro real de planes").

BEGIN;

-- Ventaja de Pro: puede exigir anticipo al reservar (ver plans.controller.js
-- / appointments.controller.js). El resto de columnas de perks ya existían.
ALTER TABLE plans ADD COLUMN deposit_payments BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE plans SET deposit_payments = TRUE WHERE code = 'pro';

-- Monto fijo en pesos que el negocio define por servicio; NULL o 0 = sin
-- anticipo (comportamiento actual). Solo se hace cumplir si el plan del
-- negocio tiene deposit_payments = TRUE (ver appointments.controller.js).
ALTER TABLE products ADD COLUMN deposit_amount NUMERIC(10,2) CHECK (deposit_amount IS NULL OR deposit_amount >= 0);

-- 'pendiente_pago': hold temporal mientras el cliente paga el anticipo en
-- Stripe (nunca llega por PATCH público, solo lo asigna appointments.create).
-- hold_expires_at solo se usa en ese estado; NULL en cualquier otro.
ALTER TABLE appointments
    DROP CONSTRAINT appointments_status_check,
    ADD CONSTRAINT appointments_status_check
        CHECK (status IN ('pendiente','confirmada','cancelada','completada','no_asistio','pendiente_pago')),
    ADD COLUMN deposit_amount NUMERIC(10,2),
    ADD COLUMN stripe_payment_intent_id TEXT,
    ADD COLUMN hold_expires_at TIMESTAMPTZ;

COMMIT;
