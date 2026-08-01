import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, ShoppingBag, Trash } from "@phosphor-icons/react";
import { api, ApiError, imageUrl } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { COUNTRIES, joinPhone, splitPhone } from "../lib/countries";
import type { Appointment, BusinessHour, Category, Order, Plan, Product, Service, Store, StoreStats } from "../types";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const STATUSES: Appointment["status"][] = ["pendiente", "confirmada", "completada", "no_asistio", "cancelada"];
const TIMEZONES: string[] =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/Mexico_City"];
const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

type DayRow = { enabled: boolean; start_time: string; end_time: string };

function emptyWeek(): DayRow[] {
    return DAYS.map(() => ({ enabled: false, start_time: "09:00", end_time: "18:00" }));
}

// Selector de país (código de marcado) + número local, combinados en un solo
// teléfono con código de país (lo que WhatsApp necesita para funcionar).
function PhoneInput({ value, onChange }: { value: string; onChange: (fullPhone: string) => void }) {
    const parsed = splitPhone(value);

    function update(dial: string, local: string) {
        onChange(joinPhone(dial, local));
    }

    return (
        <div className="inline-form">
            <select value={parsed.dial} onChange={(e) => update(e.target.value, parsed.local)}>
                {COUNTRIES.map((c) => (
                    <option key={c.dial} value={c.dial}>
                        +{c.dial} {c.name}
                    </option>
                ))}
            </select>
            <input
                value={parsed.local}
                onChange={(e) => update(parsed.dial, e.target.value)}
                placeholder="312 123 4567"
            />
        </div>
    );
}

export default function Dashboard() {
    const [stores, setStores] = useState<Store[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api
            .get<Store[]>("/stores/mine")
            .then(setStores)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar tu negocio"));
    }, []);

    if (error) return <p className="error">{error}</p>;
    if (!stores) return <p>Cargando...</p>;
    if (stores.length === 0) return <CreateStore onCreated={(s) => setStores([s])} />;

    return <StorePanel store={stores[0]} />;
}

function CreateStore({ onCreated }: { onCreated: (store: Store) => void }) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [city, setCity] = useState("");
    const [phone, setPhone] = useState("");
    const [timezone, setTimezone] = useState(BROWSER_TIMEZONE);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const store = await api.post<Store>("/stores", { name, description, city, phone, timezone });
            onCreated(store);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo crear el negocio");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="card form-card">
            <h1>Registra tu negocio</h1>
            <form onSubmit={handleSubmit}>
                <label className="field">
                    Nombre
                    <input value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label className="field">
                    Descripción
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
                <label className="field">
                    Ciudad
                    <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Colima" />
                </label>
                <label className="field">
                    Teléfono / WhatsApp
                    <PhoneInput value={phone} onChange={setPhone} />
                </label>
                <label className="field">
                    Zona horaria (define tu horario de citas)
                    <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                        {TIMEZONES.map((tz) => (
                            <option key={tz} value={tz}>
                                {tz}
                            </option>
                        ))}
                    </select>
                </label>
                {error && <p className="error">{error}</p>}
                <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading ? "Creando..." : "Crear negocio"}
                </button>
            </form>
        </div>
    );
}

function StorePanel({ store: initialStore }: { store: Store }) {
    const [store, setStore] = useState(initialStore);
    const [phone, setPhone] = useState(initialStore.phone ?? "");
    const [savingPhone, setSavingPhone] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);

    async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("logo", file);
            const updated = await api.upload<Store>(`/stores/${store.id}/logo`, formData);
            setStore(updated);
        } catch {
            // deja el logo como estaba si falla
        } finally {
            setUploading(false);
            if (fileInput.current) fileInput.current.value = "";
        }
    }

    async function savePhone() {
        setSavingPhone(true);
        try {
            const updated = await api.patch<Store>(`/stores/${store.id}`, { phone });
            setStore(updated);
        } catch {
            // deja el teléfono como estaba si falla
        } finally {
            setSavingPhone(false);
        }
    }

    return (
        <div>
            {!store.is_active && (
                <div className="card" style={{ borderColor: "var(--accent)", background: "var(--accent-bg)" }}>
                    <p>
                        <strong>Tu negocio está pendiente de aprobación.</strong> Todavía no aparece en el mercado ni
                        puede recibir citas o pedidos. Mientras tanto puedes preparar horario, servicios y productos.
                    </p>
                </div>
            )}
            {store.logo_url && <img src={imageUrl(store.logo_url)!} alt="" className="store-logo-large" />}
            <h1>{store.name}</h1>
            <p className="muted">Zona horaria: {store.timezone}</p>
            <label className="field">
                Logo del negocio
                <input ref={fileInput} type="file" accept="image/*" onChange={handleLogoChange} disabled={uploading} />
            </label>
            <label className="field">
                Teléfono / WhatsApp
                <div className="inline-form">
                    <PhoneInput value={phone} onChange={setPhone} />
                    <button className="btn btn-primary btn-sm" onClick={savePhone} disabled={savingPhone}>
                        {savingPhone ? "Guardando..." : "Guardar"}
                    </button>
                </div>
            </label>
            <div className="card-stack">
                <StatsPanel storeId={store.id} />
                <PlanManager store={store} onChanged={setStore} />
                <BusinessHoursEditor storeId={store.id} />
                <ServicesManager storeId={store.id} />
                <ProductsManager storeId={store.id} />
                <AppointmentsManager storeId={store.id} storeTimezone={store.timezone} />
                <OrdersManager storeId={store.id} />
            </div>
        </div>
    );
}

const APPOINTMENT_STAT_LABELS: Record<Appointment["status"], string> = {
    pendiente: "Pendientes",
    confirmada: "Confirmadas",
    completada: "Completadas",
    no_asistio: "No asistió",
    cancelada: "Canceladas",
};

const ORDER_STAT_LABELS: Record<Order["status"], string> = {
    pendiente: "Pendientes",
    pagado: "Pagados",
    entregado: "Entregados",
    cancelado: "Cancelados",
};

function StatsPanel({ storeId }: { storeId: string }) {
    const [stats, setStats] = useState<StoreStats | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api
            .get<StoreStats>(`/stores/${storeId}/stats`)
            .then(setStats)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar las estadísticas"));
    }, [storeId]);

    if (error) return <p className="error">{error}</p>;
    if (!stats) return <section className="card"><p className="muted">Cargando estadísticas...</p></section>;

    const appointmentsTotal = stats.appointments_by_status.reduce((sum, s) => sum + s.count, 0);
    const ordersTotal = stats.orders_by_status.reduce((sum, s) => sum + s.count, 0);
    const revenueTotal = stats.orders_by_status
        .filter((s) => s.status === "pagado" || s.status === "entregado")
        .reduce((sum, s) => sum + Number(s.revenue), 0);

    return (
        <section className="card">
            <h2>Estadísticas</h2>
            <div className="stats-grid">
                <div className="stat-tile stat-tile-highlight">
                    <Eye size={18} />
                    <strong>{stats.page_views}</strong>
                    <span className="muted">Visitas a tu página</span>
                </div>
                <div className="stat-tile stat-tile-highlight">
                    <ShoppingBag size={18} />
                    <strong>${revenueTotal.toFixed(2)}</strong>
                    <span className="muted">Ingresos (pagados/entregados)</span>
                </div>
            </div>

            <h3>Citas ({appointmentsTotal})</h3>
            <div className="stats-grid">
                {STATUSES.map((status) => (
                    <div className="stat-tile" key={status}>
                        <strong>{stats.appointments_by_status.find((s) => s.status === status)?.count ?? 0}</strong>
                        <span className="muted">{APPOINTMENT_STAT_LABELS[status]}</span>
                    </div>
                ))}
            </div>

            <h3>Pedidos ({ordersTotal})</h3>
            <div className="stats-grid">
                {ORDER_STATUSES.map((status) => (
                    <div className="stat-tile" key={status}>
                        <strong>{stats.orders_by_status.find((s) => s.status === status)?.count ?? 0}</strong>
                        <span className="muted">{ORDER_STAT_LABELS[status]}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

// Beneficios que distinguen a cada plan (max_products ya se muestra aparte).
const PLAN_PERKS: { key: keyof Plan; label: string }[] = [
    { key: "whatsapp_daily_summary", label: "Resumen diario de citas por WhatsApp" },
    { key: "whatsapp_cancellation_alerts", label: "Aviso inmediato por cancelación" },
    { key: "featured_placement", label: "Prioridad en resultados y home" },
];

function PlanManager({ store, onChanged }: { store: Store; onChanged: (store: Store) => void }) {
    const [plans, setPlans] = useState<Plan[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loadingCode, setLoadingCode] = useState<string | null>(null);

    useEffect(() => {
        api.get<Plan[]>("/plans").then(setPlans).catch(() => {});
    }, []);

    // Si volvemos de Stripe con ?plan_session_id=..., confirma la suscripción al
    // instante (el webhook la activa de todos modos si el dueño nunca vuelve).
    useEffect(() => {
        const sessionId = new URLSearchParams(window.location.search).get("plan_session_id");
        if (!sessionId) return;
        api
            .post<Store>(`/stores/${store.id}/plan/confirm`, { session_id: sessionId })
            .then(onChanged)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo confirmar el pago"))
            .finally(() => window.history.replaceState({}, "", "/mi-negocio"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function choose(code: string) {
        setError(null);
        setLoadingCode(code);
        try {
            if (code === "free") {
                const updated = await api.patch<Store>(`/stores/${store.id}/plan`, { plan_code: code });
                onChanged(updated);
            } else {
                const { url } = await api.post<{ url: string }>(`/stores/${store.id}/plan/checkout-session`, {
                    plan_code: code,
                });
                window.location.href = url;
                return;
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo cambiar de plan");
        } finally {
            setLoadingCode(null);
        }
    }

    if (!plans) return <section className="card"><p className="muted">Cargando planes...</p></section>;

    const currentCode = plans.find((p) => p.id === store.plan_id)?.code ?? "free";

    return (
        <section className="card">
            <h2>Plan de suscripción</h2>
            {error && <p className="error">{error}</p>}
            <div className="stats-grid">
                {plans.map((p) => (
                    <div className={`stat-tile ${p.code === currentCode ? "stat-tile-highlight" : ""}`} key={p.id}>
                        <strong>{p.name}</strong>
                        <span>{Number(p.price_mxn) > 0 ? `$${p.price_mxn}/mes` : "Gratis"}</span>
                        <span className="muted">
                            {p.max_products ? `${p.max_products} productos/servicios` : "Productos/servicios ilimitados"}
                        </span>
                        {PLAN_PERKS.filter((perk) => p[perk.key]).map((perk) => (
                            <span className="muted" key={perk.key}>
                                {perk.label}
                            </span>
                        ))}
                        {p.code === currentCode ? (
                            <button className="btn btn-ghost btn-sm" disabled>
                                Plan actual
                            </button>
                        ) : (
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => choose(p.code)}
                                disabled={loadingCode === p.code}
                            >
                                {loadingCode === p.code ? "Procesando..." : p.code === "free" ? "Bajar a Free" : "Suscribirme"}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}

function BusinessHoursEditor({ storeId }: { storeId: string }) {
    const [week, setWeek] = useState<DayRow[]>(emptyWeek());
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        api.get<BusinessHour[]>(`/stores/${storeId}/business-hours`).then((hours) => {
            setWeek((week) =>
                week.map((row, day) => {
                    const existing = hours.find((h) => h.day_of_week === day);
                    return existing
                        ? { enabled: true, start_time: existing.start_time.slice(0, 5), end_time: existing.end_time.slice(0, 5) }
                        : row;
                })
            );
        });
    }, [storeId]);

    function updateDay(day: number, patch: Partial<DayRow>) {
        setWeek((week) => week.map((row, i) => (i === day ? { ...row, ...patch } : row)));
    }

    async function save() {
        setLoading(true);
        setStatus(null);
        const hours = week
            .map((row, day) => ({ day_of_week: day, start_time: row.start_time, end_time: row.end_time, enabled: row.enabled }))
            .filter((row) => row.enabled)
            .map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time }));
        try {
            await api.put(`/stores/${storeId}/business-hours`, { hours });
            setStatus("Horario guardado.");
        } catch (err) {
            setStatus(err instanceof ApiError ? err.message : "No se pudo guardar el horario");
        } finally {
            setLoading(false);
        }
    }

    return (
        <section className="card">
            <h2>Horario semanal</h2>
            {week.map((row, day) => (
                <div className="hours-row" key={day}>
                    <label>
                        <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => updateDay(day, { enabled: e.target.checked })}
                        />
                        {DAYS[day]}
                    </label>
                    <input
                        type="time"
                        value={row.start_time}
                        disabled={!row.enabled}
                        onChange={(e) => updateDay(day, { start_time: e.target.value })}
                    />
                    <input
                        type="time"
                        value={row.end_time}
                        disabled={!row.enabled}
                        onChange={(e) => updateDay(day, { end_time: e.target.value })}
                    />
                </div>
            ))}
            <button className="btn btn-primary" onClick={save} disabled={loading}>
                {loading ? "Guardando..." : "Guardar horario"}
            </button>
            {status && <p>{status}</p>}
        </section>
    );
}

function ServicesManager({ storeId }: { storeId: string }) {
    const [services, setServices] = useState<Service[] | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [form, setForm] = useState({ name: "", description: "", price: "", duration_minutes: "30", buffer_minutes: "0", capacity: "1", category_id: "" });
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    function load() {
        api.get<Service[]>(`/stores/${storeId}/services`).then(setServices);
    }

    useEffect(load, [storeId]);
    useEffect(() => {
        api.get<Category[]>("/categories?kind=service").then(setCategories).catch(() => {});
    }, []);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await api.post(`/stores/${storeId}/services`, {
                name: form.name,
                description: form.description,
                price: Number(form.price),
                duration_minutes: Number(form.duration_minutes),
                buffer_minutes: Number(form.buffer_minutes),
                capacity: Number(form.capacity),
                category_id: form.category_id || undefined,
            });
            setForm({ name: "", description: "", price: "", duration_minutes: "30", buffer_minutes: "0", capacity: "1", category_id: "" });
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo crear el servicio");
        } finally {
            setLoading(false);
        }
    }

    return (
        <section className="card">
            <h2>Servicios</h2>
            {services?.map((s) => (
                <ServiceRow key={s.id} service={s} onChanged={load} />
            ))}

            <form onSubmit={handleSubmit} className="inline-form">
                <input placeholder="Nombre" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                <input placeholder="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                <select value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                    <option value="">Sin categoría</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <input placeholder="Precio" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} required />
                <input placeholder="Duración (min)" type="number" min="1" value={form.duration_minutes} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))} required />
                <input placeholder="Colchón (min)" type="number" min="0" value={form.buffer_minutes} onChange={(e) => setForm((f) => ({ ...f, buffer_minutes: e.target.value }))} />
                <input placeholder="Capacidad" type="number" min="1" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
                <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading ? "Agregando..." : "Agregar servicio"}
                </button>
            </form>
            {error && <p className="error">{error}</p>}
        </section>
    );
}

function ServiceRow({ service, onChanged }: { service: Service; onChanged: () => void }) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append("image", file);
            await api.upload(`/services/${service.id}/images`, formData);
            onChanged();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo subir la imagen");
        } finally {
            setUploading(false);
            if (fileInput.current) fileInput.current.value = "";
        }
    }

    async function removeImage(imageId: string) {
        await api.delete(`/services/${service.id}/images/${imageId}`);
        onChanged();
    }

    return (
        <div className="service-row">
            <strong>{service.name}</strong> · ${service.price} · {service.duration_minutes} min · capacidad{" "}
            {service.capacity}
            <div className="gallery">
                {service.images?.map((img) => (
                    <div key={img.id} className="gallery-item">
                        <img src={imageUrl(img.url)!} alt="" />
                        <button className="btn btn-ghost btn-sm" onClick={() => removeImage(img.id)}>
                            <Trash size={13} /> Quitar
                        </button>
                    </div>
                ))}
            </div>
            <input ref={fileInput} type="file" accept="image/*" onChange={handleFileChange} disabled={uploading} />
            {error && <p className="error">{error}</p>}
        </div>
    );
}

function AppointmentsManager({ storeId, storeTimezone }: { storeId: string; storeTimezone: string }) {
    const [appointments, setAppointments] = useState<Appointment[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    function load() {
        api
            .get<Appointment[]>(`/stores/${storeId}/appointments`)
            .then(setAppointments)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar las citas"));
    }

    useEffect(load, [storeId]);

    async function changeStatus(id: string, status: Appointment["status"]) {
        try {
            await api.patch(`/appointments/${id}/status`, { status });
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo actualizar la cita");
        }
    }

    return (
        <section className="card">
            <h2>Citas</h2>
            {error && <p className="error">{error}</p>}
            {!appointments ? (
                <p>Cargando...</p>
            ) : appointments.length === 0 ? (
                <p>Todavía no hay citas.</p>
            ) : (
                appointments.map((a) => (
                    <div className="appointment-row" key={a.id}>
                        <span>
                            {a.service_name} · {formatDateTime(a.starts_at, storeTimezone)}
                            {a.party_size ? ` · ${a.party_size} personas` : ""} ·{" "}
                            {a.customer_name || a.customer_email}
                        </span>
                        <select value={a.status} onChange={(e) => changeStatus(a.id, e.target.value as Appointment["status"])}>
                            {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </div>
                ))
            )}
        </section>
    );
}

function ProductsManager({ storeId }: { storeId: string }) {
    const [products, setProducts] = useState<Product[] | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [form, setForm] = useState({ name: "", description: "", price: "", stock: "1", category_id: "" });
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    function load() {
        api.get<Product[]>(`/stores/${storeId}/products`).then(setProducts);
    }

    useEffect(load, [storeId]);
    useEffect(() => {
        api.get<Category[]>("/categories?kind=product").then(setCategories).catch(() => {});
    }, []);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await api.post(`/stores/${storeId}/products`, {
                name: form.name,
                description: form.description,
                price: Number(form.price),
                stock: Number(form.stock),
                category_id: form.category_id || undefined,
            });
            setForm({ name: "", description: "", price: "", stock: "1", category_id: "" });
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo crear el producto");
        } finally {
            setLoading(false);
        }
    }

    return (
        <section className="card">
            <h2>Productos</h2>
            {products?.map((p) => (
                <ProductRow key={p.id} product={p} onChanged={load} />
            ))}

            <form onSubmit={handleSubmit} className="inline-form">
                <input placeholder="Nombre" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                <input placeholder="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                <select value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                    <option value="">Sin categoría</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <input placeholder="Precio" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} required />
                <input placeholder="Inventario" type="number" min="0" value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))} required />
                <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading ? "Agregando..." : "Agregar producto"}
                </button>
            </form>
            {error && <p className="error">{error}</p>}
        </section>
    );
}

function ProductRow({ product, onChanged }: { product: Product; onChanged: () => void }) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append("image", file);
            await api.upload(`/products/${product.id}/images`, formData);
            onChanged();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo subir la imagen");
        } finally {
            setUploading(false);
            if (fileInput.current) fileInput.current.value = "";
        }
    }

    async function removeImage(imageId: string) {
        await api.delete(`/products/${product.id}/images/${imageId}`);
        onChanged();
    }

    return (
        <div className="service-row">
            <strong>{product.name}</strong> · ${product.price} · {product.stock} en inventario
            <div className="gallery">
                {product.images?.map((img) => (
                    <div key={img.id} className="gallery-item">
                        <img src={imageUrl(img.url)!} alt="" />
                        <button className="btn btn-ghost btn-sm" onClick={() => removeImage(img.id)}>
                            <Trash size={13} /> Quitar
                        </button>
                    </div>
                ))}
            </div>
            <input ref={fileInput} type="file" accept="image/*" onChange={handleFileChange} disabled={uploading} />
            {error && <p className="error">{error}</p>}
        </div>
    );
}

const ORDER_STATUSES: Order["status"][] = ["pendiente", "pagado", "entregado", "cancelado"];

function OrdersManager({ storeId }: { storeId: string }) {
    const [orders, setOrders] = useState<Order[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    function load() {
        api
            .get<Order[]>(`/stores/${storeId}/orders`)
            .then(setOrders)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar los pedidos"));
    }

    useEffect(load, [storeId]);

    async function changeStatus(id: string, status: Order["status"]) {
        try {
            await api.patch(`/orders/${id}/status`, { status });
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo actualizar el pedido");
        }
    }

    return (
        <section className="card">
            <h2>Pedidos</h2>
            {error && <p className="error">{error}</p>}
            {!orders ? (
                <p className="muted">Cargando...</p>
            ) : orders.length === 0 ? (
                <p className="muted">Todavía no hay pedidos.</p>
            ) : (
                orders.map((o) => (
                    <div className="appointment-row" key={o.id}>
                        <span>
                            {o.items.map((it) => `${it.quantity}× ${it.name}`).join(", ")} · ${o.total_amount} ·{" "}
                            {o.customer_name || o.customer_email}
                        </span>
                        <select value={o.status} onChange={(e) => changeStatus(o.id, e.target.value as Order["status"])}>
                            {ORDER_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </div>
                ))
            )}
        </section>
    );
}
