-- Migración incremental: agrega el chat por pedido/cita sin recrear la BD.

BEGIN;

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (
        (order_id IS NOT NULL AND appointment_id IS NULL) OR
        (order_id IS NULL AND appointment_id IS NOT NULL)
    )
);

CREATE INDEX idx_messages_order ON messages(order_id, created_at);
CREATE INDEX idx_messages_appointment ON messages(appointment_id, created_at);

COMMIT;
