-- Migración incremental: base técnica para dos huecos legales (pendiente
-- revisión de un abogado, esto NO es asesoría legal):
--   1. Registro auditable de que quien sube una imagen confirmó tener los
--      derechos o autorización para usarla (ver config/upload.js).
--   2. Poder honrar una solicitud de borrado de cuenta sin romper el
--      historial de pedidos/citas de los negocios (ver auth.controller.js).

BEGIN;

CREATE TABLE image_upload_attestations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    url TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('logo', 'product_image')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_image_upload_attestations_user ON image_upload_attestations(user_id);

-- NULL = cuenta activa. Al autoeliminarse, el usuario se anonimiza en vez de
-- borrarse (orders.user_id, appointments.customer_id, cart_items.user_id y
-- messages.sender_id son NOT NULL sin ON DELETE CASCADE -- borrar la fila de
-- verdad rompería esas referencias o se llevaría entre pies el historial que
-- el negocio necesita conservar).
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;

COMMIT;
