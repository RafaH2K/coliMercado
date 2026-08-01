export interface User {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
    is_admin: boolean;
    created_at: string;
}

export interface Store {
    id: string;
    owner_id: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    phone: string | null;
    city: string | null;
    timezone: string;
    is_active: boolean;
    created_at: string;
    plan_id: string | null;
    avg_rating?: number;
    review_count?: number;
}

export interface SubscriptionStatus {
    subscribed: boolean;
    status?: string;
    cancel_at_period_end?: boolean;
    cancel_at?: number | null; // timestamp Unix (segundos) en que se hará efectiva la cancelación
}

export interface Plan {
    id: string;
    code: "free" | "basico" | "pro";
    name: string;
    price_mxn: string;
    max_products: number | null;
    whatsapp_daily_summary: boolean;
    whatsapp_summary_mode_choice: boolean;
    whatsapp_cancellation_alerts: boolean;
    featured_placement: boolean;
    deposit_payments: boolean;
}

export interface PendingStore {
    id: string;
    name: string;
    description: string | null;
    city: string | null;
    phone: string | null;
    is_active: boolean;
    created_at: string;
    owner_name: string | null;
    owner_email: string;
}

export interface Category {
    id: string;
    name: string;
    description: string | null;
    parent_id: string | null;
    kind: "service" | "product";
}

export interface Review {
    id: string;
    store_id: string;
    user_id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    updated_at: string;
    customer_name?: string;
}

export interface ProductImage {
    id: string;
    url: string;
    position: number;
}

export interface Service {
    id: string;
    store_id: string;
    category_id: string | null;
    name: string;
    description: string | null;
    type: "product" | "service";
    price: string;
    duration_minutes: number | null;
    buffer_minutes: number | null;
    capacity: number | null;
    is_active: boolean;
    deposit_amount: string | null;
    store_timezone?: string;
    store_name?: string;
    images?: ProductImage[];
}

export interface Product {
    id: string;
    store_id: string;
    category_id: string | null;
    name: string;
    description: string | null;
    type: "product" | "service";
    price: string;
    stock: number | null;
    is_active: boolean;
    store_name?: string;
    store_city?: string;
    images?: ProductImage[];
}

export interface CartItem {
    product_id: string;
    quantity: number;
    name: string;
    price: string;
    stock: number;
    store_id: string;
    store_name: string;
    image_url: string | null;
}

export interface OrderItem {
    product_id: string;
    name: string;
    quantity: number;
    price_at_purchase: string;
}

export interface Order {
    id: string;
    user_id: string;
    store_id: string;
    total_amount: string;
    status: "pendiente" | "pagado" | "entregado" | "cancelado";
    created_at: string;
    store_name?: string;
    customer_name?: string;
    customer_email?: string;
    items: OrderItem[];
}

export interface StoreStats {
    page_views: number;
    appointments_by_status: { status: Appointment["status"]; count: number }[];
    orders_by_status: { status: Order["status"]; count: number; revenue: string }[];
}

export interface BusinessHour {
    id?: string;
    day_of_week: number; // 0=domingo .. 6=sábado
    start_time: string; // "HH:MM"
    end_time: string;
}

export interface Slot {
    starts_at: string;
    ends_at: string;
}

export interface Message {
    id: string;
    order_id: string | null;
    appointment_id: string | null;
    sender_id: string;
    body: string;
    created_at: string;
}

// El backend devuelve esto en vez de la cita cuando el servicio exige
// anticipo (Pro): hay que redirigir a Stripe antes de que exista la cita.
export interface AppointmentDepositRequired {
    requires_payment: true;
    checkout_url: string;
    appointment_id: string;
}

export interface Appointment {
    id: string;
    product_id: string;
    customer_id: string;
    starts_at: string;
    ends_at: string;
    status: "pendiente" | "confirmada" | "cancelada" | "completada" | "no_asistio";
    notes: string | null;
    party_size?: number | null;
    service_name?: string;
    store_id?: string;
    customer_name?: string;
    customer_email?: string;
    store_timezone?: string;
}
