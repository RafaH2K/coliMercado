-- Migración incremental: agrega planes de suscripción sin recrear la BD.
-- Aplica sobre el esquema actual (post "Agrega recuperacion de contraseña").

BEGIN;

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL CHECK (code IN ('free', 'basico', 'pro')),
    name TEXT NOT NULL,
    price_mxn NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_products INT, -- tope de productos/servicios activos; NULL = ilimitado
    whatsapp_daily_summary BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_summary_mode_choice BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_cancellation_alerts BOOLEAN NOT NULL DEFAULT FALSE,
    featured_placement BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO plans (code, name, price_mxn, max_products, whatsapp_daily_summary, whatsapp_summary_mode_choice, whatsapp_cancellation_alerts, featured_placement) VALUES
    ('free',   'Free',    0,   5,    FALSE, FALSE, FALSE, FALSE),
    ('basico', 'Básico',  150, 20,   TRUE,  FALSE, FALSE, FALSE),
    ('pro',    'Pro',     300, NULL, TRUE,  TRUE,  TRUE,  TRUE);

ALTER TABLE stores
    ADD COLUMN plan_id UUID REFERENCES plans(id),
    ADD COLUMN whatsapp_summary_time TIME,
    ADD COLUMN whatsapp_summary_mode TEXT NOT NULL DEFAULT 'mismo_dia'
        CHECK (whatsapp_summary_mode IN ('mismo_dia', 'noche_anterior'));

COMMIT;
