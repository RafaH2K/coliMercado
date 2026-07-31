CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);


CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    logo_url TEXT,
    phone TEXT, -- contacto del negocio (llamada/WhatsApp), independiente del teléfono personal del dueño
    city TEXT, -- texto libre para búsqueda por ubicación; geo real (lat/lng) queda para cuando haya multiciudad de verdad
    timezone TEXT NOT NULL DEFAULT 'America/Mexico_City', -- nombre IANA; da sentido a business_hours/special_dates
    -- Controlado solo por un admin (ver admin.controller.js), no por el dueño:
    -- FALSE = pendiente de aprobación (oculto de todo lo público, el dueño sí
    -- puede seguir preparando su negocio desde el dashboard).
    is_active BOOLEAN DEFAULT TRUE,
    page_views INT NOT NULL DEFAULT 0, -- contador simple, incrementado en cada GET /stores/:id público
    created_at TIMESTAMP DEFAULT NOW()
);


CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES categories(id),
    -- 'service' agrupa negocios/servicios reservables (Peluquería, Spa...);
    -- 'product' agrupa mercancía física del Mercado (Belleza, Hogar...).
    -- Son taxonomías distintas aunque compartan tabla: category_id en
    -- products apunta a una u otra según el type del producto.
    kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service', 'product'))
);


CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id),
    category_id UUID REFERENCES categories(id),
    
    name TEXT NOT NULL,
    description TEXT,
    
    type TEXT CHECK (type IN ('product', 'service')),
    
    price NUMERIC(10,2) NOT NULL,
    stock INT, -- NULL para servicios

    -- Los siguientes 3 campos solo aplican cuando type='service'
    duration_minutes INT,          -- cuánto ocupa la cita en el calendario
    buffer_minutes INT DEFAULT 0,  -- colchón entre una cita y la siguiente (limpieza, preparación)
    capacity INT DEFAULT 1 CHECK (capacity > 0), -- citas simultáneas permitidas (ej. clase grupal)

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);


CREATE TABLE product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    position INT DEFAULT 0
);


CREATE TABLE cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    product_id UUID REFERENCES products(id) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, product_id)
);


CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    store_id UUID REFERENCES stores(id) NOT NULL, -- un pedido = un negocio; un carrito con varias tiendas genera varios pedidos
    total_amount NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','pagado','entregado','cancelado')),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_store ON orders(store_id);


CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES products(id) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    price_at_purchase NUMERIC(10,2) NOT NULL
);


CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id),
    amount NUMERIC(10,2),
    provider TEXT,      -- stripe, paypal, efectivo, etc.
    status TEXT,        -- pending, paid, failed
    stripe_session_id TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- Sistema de reservaciones
-- ============================================================

-- Necesaria para el EXCLUDE constraint de appointments (índice GiST
-- sobre una columna UUID con igualdad, además del rango de tiempo).
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- Horario semanal recurrente de cada negocio. Varias filas por
-- mismo day_of_week permiten turnos partidos (ej. 09-13 y 15-19).
CREATE TABLE business_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=domingo … 6=sábado (convención EXTRACT(DOW) de Postgres)
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    CHECK (end_time > start_time)
);

CREATE INDEX idx_business_hours_store ON business_hours(store_id, day_of_week);


-- Excepciones puntuales al horario semanal: días feriados (is_closed)
-- u horario distinto al habitual para una fecha específica.
CREATE TABLE special_dates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
    date DATE NOT NULL,
    is_closed BOOLEAN NOT NULL DEFAULT TRUE,
    start_time TIME,
    end_time TIME,
    reason TEXT,
    UNIQUE (store_id, date),
    CHECK (is_closed OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);


-- Bloqueos puntuales dentro de un día habilitado (mantenimiento,
-- ausencia del personal, etc.), a diferencia de special_dates que
-- reemplaza el día completo.
CREATE TABLE blocked_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX idx_blocked_slots_store_time ON blocked_slots(store_id, starts_at);


-- Citas reservadas por los clientes sobre un producto/servicio.
-- TIMESTAMPTZ (a diferencia del TIMESTAMP usado arriba) porque una
-- agenda sí necesita ser correcta ante zonas horarias distintas
-- cuando la plataforma crezca a multiciudad.
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) NOT NULL, -- el servicio reservado
    customer_id UUID REFERENCES users(id) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (status IN ('pendiente','confirmada','cancelada','completada','no_asistio')),
    party_size SMALLINT CHECK (party_size > 0), -- número de personas; útil para reservación de mesas en restaurantes
    notes TEXT,
    -- Copia de products.capacity al momento de reservar. Necesaria para que
    -- el EXCLUDE de abajo solo aplique a servicios de un solo cupo — un
    -- EXCLUDE sin este filtro bloquearía CUALQUIER traslape sin importar
    -- cuántos cupos tenga el servicio (una mesa con capacidad 3 nunca
    -- podría tener una segunda reservación en el mismo horario), rompiendo
    -- por completo el soporte de capacity>1.
    capacity_snapshot INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (ends_at > starts_at),

    -- Bloquea a nivel de base de datos dos citas activas que se traslapen
    -- para el mismo servicio, pero SOLO cuando capacity_snapshot=1 (la
    -- mayoría: peluquería, dentista, taller...). Para capacity>1 (mesa de
    -- restaurante, clase grupal) esta constraint no aplica — la app debe
    -- contar citas activas contra products.capacity antes de insertar
    -- (bajo un pg_advisory_xact_lock para que sea seguro con concurrencia).
    -- Subir a un modelo de recursos/personal por cita cuando se implemente
    -- gestión de empleados.
    EXCLUDE USING gist (
        product_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
    ) WHERE (status IN ('pendiente','confirmada') AND capacity_snapshot = 1)
);

CREATE INDEX idx_appointments_customer ON appointments(customer_id);
CREATE INDEX idx_appointments_product_time ON appointments(product_id, starts_at);


-- ============================================================
-- Descubrimiento: favoritos y reseñas
-- ============================================================

CREATE TABLE favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, store_id)
);

CREATE INDEX idx_favorites_user ON favorites(user_id);


-- Una reseña por cliente por negocio (reenviar el POST actualiza la propia,
-- no se necesita moderación separada para MVP).
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (store_id, user_id)
);

CREATE INDEX idx_reviews_store ON reviews(store_id);

