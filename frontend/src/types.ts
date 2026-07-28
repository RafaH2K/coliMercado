export interface User {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
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
    avg_rating?: number;
    review_count?: number;
}

export interface Category {
    id: string;
    name: string;
    description: string | null;
    parent_id: string | null;
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
    store_timezone?: string;
    images?: ProductImage[];
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

export interface Appointment {
    id: string;
    product_id: string;
    customer_id: string;
    starts_at: string;
    ends_at: string;
    status: "pendiente" | "confirmada" | "cancelada" | "completada" | "no_asistio";
    notes: string | null;
    service_name?: string;
    store_id?: string;
    customer_name?: string;
    customer_email?: string;
    store_timezone?: string;
}
