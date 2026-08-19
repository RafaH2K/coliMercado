import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChatCircle, Eye, ShoppingBag, Trash } from "@phosphor-icons/react";
import { api, ApiError, imageUrl } from "../lib/api";
import { formatDateTime, formatTime, orderFolio } from "../lib/format";
import { COUNTRIES, joinPhone, splitPhone } from "../lib/countries";
import ChatPanel from "../components/ChatPanel";
import type {
    Appointment,
    BlockedSlot,
    BusinessHour,
    Category,
    Order,
    Plan,
    Product,
    Service,
    SpecialDate,
    Store,
    StoreStats,
    SubscriptionStatus,
} from "../types";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const STATUSES: Appointment["status"][] = ["pendiente", "confirmada", "completada", "no_asistio", "cancelada"];

// El ciclo de vida de una cita solo avanza (ver ALLOWED_APPOINTMENT_TRANSITIONS
// en appointments.controller.js) -- el select del dueño solo debe ofrecer lo
// que el backend de verdad va a aceptar.
const APPOINTMENT_NEXT_STATUSES: Record<Appointment["status"], Appointment["status"][]> = {
    pendiente: ["confirmada", "completada", "no_asistio", "cancelada"],
    confirmada: ["completada", "no_asistio", "cancelada"],
    completada: [],
    no_asistio: [],
    cancelada: [],
};
const TIMEZONES: string[] =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/Mexico_City"];
const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

type TimeRange = { start_time: string; end_time: string };
type DayRow = { enabled: boolean; ranges: TimeRange[] };

function emptyWeek(): DayRow[] {
    return DAYS.map(() => ({ enabled: false, ranges: [{ start_time: "09:00", end_time: "18:00" }] }));
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
    const [plans, setPlans] = useState<Plan[] | null>(null);

    useEffect(() => {
        api.get<Plan[]>("/plans").then(setPlans).catch(() => {});
    }, []);
    const isPro = plans?.find((p) => p.id === store.plan_id)?.code === "pro";

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
                <PlanManager store={store} plans={plans} onChanged={setStore} />
                <MercadoPagoConnect storeId={store.id} />
                <CardSurchargeNotice />
                <BusinessHoursEditor storeId={store.id} />
                <ScheduleExceptionsManager storeId={store.id} storeTimezone={store.timezone} />
                <ServicesManager storeId={store.id} allowDeposits={isPro} />
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
    // Por ahora se manda por correo (ver dailySummaryScheduler.js); WhatsApp
    // llega en una actualización futura, cuando haya credenciales de Meta.
    { key: "whatsapp_daily_summary", label: "Resumen diario de citas por correo" },
    { key: "whatsapp_cancellation_alerts", label: "Aviso inmediato por cancelación (próximamente, WhatsApp)" },
    { key: "featured_placement", label: "Prioridad en resultados y home" },
    { key: "deposit_payments", label: "Puede cobrar anticipo al reservar" },
];

function PlanManager({
    store,
    plans,
    onChanged,
}: {
    store: Store;
    plans: Plan[] | null;
    onChanged: (store: Store) => void;
}) {
    const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loadingCode, setLoadingCode] = useState<string | null>(null);
    const [cancelBusy, setCancelBusy] = useState(false);

    function loadSubscription() {
        api.get<SubscriptionStatus>(`/stores/${store.id}/plan/subscription`).then(setSubscription).catch(() => {});
    }

    useEffect(loadSubscription, [store.id]);

    async function cancelPlan() {
        setCancelBusy(true);
        setError(null);
        try {
            const updated = await api.post<SubscriptionStatus>(`/stores/${store.id}/plan/cancel`, {});
            setSubscription((s) => (s ? { ...s, ...updated } : s));
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo cancelar el plan");
        } finally {
            setCancelBusy(false);
        }
    }

    async function resumePlan() {
        setCancelBusy(true);
        setError(null);
        try {
            const updated = await api.post<SubscriptionStatus>(`/stores/${store.id}/plan/resume`, {});
            setSubscription((s) => (s ? { ...s, ...updated } : s));
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo reactivar el plan");
        } finally {
            setCancelBusy(false);
        }
    }

    // Si volvemos de Stripe con ?plan_session_id=..., confirma la suscripción al
    // instante (el webhook la activa de todos modos si el dueño nunca vuelve).
    useEffect(() => {
        const sessionId = new URLSearchParams(window.location.search).get("plan_session_id");
        if (!sessionId) return;
        api
            .post<Store>(`/stores/${store.id}/plan/confirm`, { session_id: sessionId })
            .then((updated) => {
                onChanged(updated);
                loadSubscription();
            })
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
                loadSubscription();
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
                            p.code !== "free" && subscription?.subscribed ? (
                                subscription.cancel_at_period_end ? (
                                    <>
                                        <span className="muted">
                                            Se cancela el{" "}
                                            {subscription.cancel_at &&
                                                new Date(subscription.cancel_at * 1000).toLocaleDateString("es-MX")}
                                        </span>
                                        <button className="btn btn-primary btn-sm" onClick={resumePlan} disabled={cancelBusy}>
                                            {cancelBusy ? "Procesando..." : "Reactivar"}
                                        </button>
                                    </>
                                ) : (
                                    <button className="btn btn-ghost btn-sm" onClick={cancelPlan} disabled={cancelBusy}>
                                        {cancelBusy ? "Procesando..." : "Cancelar plan"}
                                    </button>
                                )
                            ) : (
                                <button className="btn btn-ghost btn-sm" disabled>
                                    Plan actual
                                </button>
                            )
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

function MercadoPagoConnect({ storeId }: { storeId: string }) {
    const [connected, setConnected] = useState<boolean | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    function loadStatus() {
        api
            .get<{ connected: boolean }>(`/stores/${storeId}/mercadopago/status`)
            .then((s) => setConnected(s.connected))
            .catch(() => {});
    }

    useEffect(loadStatus, [storeId]);

    // Si volvemos de Mercado Pago con ?mercadopago=connected|error, refresca
    // el estado y limpia la URL (mismo patrón que PlanManager con plan_session_id).
    useEffect(() => {
        const result = new URLSearchParams(window.location.search).get("mercadopago");
        if (!result) return;
        setNotice(
            result === "connected"
                ? "Tu cuenta de Mercado Pago quedó conectada."
                : "No se pudo conectar con Mercado Pago, intenta de nuevo."
        );
        loadStatus();
        window.history.replaceState({}, "", "/mi-negocio");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function connect() {
        setBusy(true);
        setError(null);
        try {
            const { url } = await api.get<{ url: string }>(`/stores/${storeId}/mercadopago/connect`);
            window.location.href = url;
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo iniciar la conexión con Mercado Pago");
            setBusy(false);
        }
    }

    async function disconnect() {
        setBusy(true);
        setError(null);
        try {
            await api.delete(`/stores/${storeId}/mercadopago`);
            setConnected(false);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo desconectar Mercado Pago");
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="card">
            <h2>Mercado Pago</h2>
            <p className="muted">
                Conecta tu cuenta de Mercado Pago para recibir directo el pago de tus productos y citas. La
                plataforma se queda con una comisión, tú recibes el resto directo en tu cuenta.
            </p>
            {notice && <p>{notice}</p>}
            {error && <p className="error">{error}</p>}
            {connected === null ? (
                <p className="muted">Cargando...</p>
            ) : connected ? (
                <div className="inline-form">
                    <span className="badge badge-confirmada">Conectado</span>
                    <button className="btn btn-ghost btn-sm" onClick={disconnect} disabled={busy}>
                        {busy ? "Procesando..." : "Desconectar"}
                    </button>
                </div>
            ) : (
                <button className="btn btn-primary" onClick={connect} disabled={busy}>
                    {busy ? "Redirigiendo..." : "Conectar con Mercado Pago"}
                </button>
            )}
        </section>
    );
}

// Aviso fijo: informa la política de recargo por tarjeta (ver
// STRIPE_CARD_SURCHARGE en orders.controller.js). No afecta lo que el
// negocio ve en sus pedidos/ingresos, solo lo que paga el cliente con tarjeta.
function CardSurchargeNotice() {
    return (
        <section className="card">
            <h2>Pagos con tarjeta</h2>
            <p className="muted">
                Cuando un cliente paga con tarjeta (Stripe), se le cobra un 12% adicional sobre el precio: cubre la
                comisión de Stripe y una comisión de la plataforma. Esto no afecta tus pedidos ni tus ingresos
                reportados aquí, que siempre reflejan tu precio de lista.
            </p>
            <p className="muted">
                Si prefieres que tus clientes no paguen ese recargo, puedes ofrecerles pagar en persona/efectivo
                directamente contigo — eso ya queda entre tú y tu cliente.
            </p>
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
                    const existing = hours.filter((h) => h.day_of_week === day);
                    return existing.length
                        ? {
                              enabled: true,
                              ranges: existing.map((h) => ({
                                  start_time: h.start_time.slice(0, 5),
                                  end_time: h.end_time.slice(0, 5),
                              })),
                          }
                        : row;
                })
            );
        });
    }, [storeId]);

    function updateDay(day: number, patch: Partial<DayRow>) {
        setWeek((week) => week.map((row, i) => (i === day ? { ...row, ...patch } : row)));
    }

    function updateRange(day: number, rangeIndex: number, patch: Partial<TimeRange>) {
        setWeek((week) =>
            week.map((row, i) =>
                i === day
                    ? { ...row, ranges: row.ranges.map((r, j) => (j === rangeIndex ? { ...r, ...patch } : r)) }
                    : row
            )
        );
    }

    function addRange(day: number) {
        setWeek((week) =>
            week.map((row, i) => (i === day ? { ...row, ranges: [...row.ranges, { start_time: "15:00", end_time: "19:00" }] } : row))
        );
    }

    function removeRange(day: number, rangeIndex: number) {
        setWeek((week) =>
            week.map((row, i) => (i === day ? { ...row, ranges: row.ranges.filter((_, j) => j !== rangeIndex) } : row))
        );
    }

    async function save() {
        setLoading(true);
        setStatus(null);
        const hours = week.flatMap((row, day) =>
            row.enabled ? row.ranges.map((r) => ({ day_of_week: day, start_time: r.start_time, end_time: r.end_time })) : []
        );
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
            <p className="muted">
                Si tu negocio cierra para comer, agrega un segundo turno en ese día (ej. 9:00-13:00 y 15:00-19:00).
            </p>
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
                    <div className="hours-ranges">
                        {row.ranges.map((range, rangeIndex) => (
                            <div className="hours-range-row" key={rangeIndex}>
                                <input
                                    type="time"
                                    value={range.start_time}
                                    disabled={!row.enabled}
                                    onChange={(e) => updateRange(day, rangeIndex, { start_time: e.target.value })}
                                />
                                <input
                                    type="time"
                                    value={range.end_time}
                                    disabled={!row.enabled}
                                    onChange={(e) => updateRange(day, rangeIndex, { end_time: e.target.value })}
                                />
                                {row.ranges.length > 1 && (
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        disabled={!row.enabled}
                                        onClick={() => removeRange(day, rangeIndex)}
                                        aria-label="Quitar turno"
                                    >
                                        <Trash size={13} />
                                    </button>
                                )}
                            </div>
                        ))}
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={!row.enabled}
                            onClick={() => addRange(day)}
                        >
                            + Agregar turno
                        </button>
                    </div>
                </div>
            ))}
            <button className="btn btn-primary" onClick={save} disabled={loading}>
                {loading ? "Guardando..." : "Guardar horario"}
            </button>
            {status && <p>{status}</p>}
        </section>
    );
}

function ScheduleExceptionsManager({ storeId, storeTimezone }: { storeId: string; storeTimezone: string }) {
    return (
        <section className="card">
            <h2>Excepciones de horario</h2>
            <p className="muted">
                Para cerrar un día festivo completo, o bloquear un hueco puntual dentro de un día que ya está
                habilitado.
            </p>
            <SpecialDatesEditor storeId={storeId} />
            <BlockedSlotsEditor storeId={storeId} storeTimezone={storeTimezone} />
        </section>
    );
}

function SpecialDatesEditor({ storeId }: { storeId: string }) {
    const [dates, setDates] = useState<SpecialDate[] | null>(null);
    const [date, setDate] = useState("");
    const [closed, setClosed] = useState(true);
    const [startTime, setStartTime] = useState("09:00");
    const [endTime, setEndTime] = useState("18:00");
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    function load() {
        api.get<SpecialDate[]>(`/stores/${storeId}/special-dates`).then(setDates).catch(() => {});
    }

    useEffect(load, [storeId]);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await api.post(`/stores/${storeId}/special-dates`, {
                date,
                is_closed: closed,
                start_time: closed ? undefined : startTime,
                end_time: closed ? undefined : endTime,
                reason: reason || undefined,
            });
            setDate("");
            setReason("");
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo guardar la fecha especial");
        } finally {
            setLoading(false);
        }
    }

    async function remove(id: string) {
        await api.delete(`/stores/${storeId}/special-dates/${id}`);
        load();
    }

    return (
        <div>
            <h3>Días festivos / horario especial</h3>
            {dates?.map((d) => (
                <div className="appointment-row" key={d.id}>
                    <span>
                        {d.date} ·{" "}
                        {d.is_closed ? "Cerrado todo el día" : `${d.start_time?.slice(0, 5)}–${d.end_time?.slice(0, 5)}`}
                        {d.reason ? ` · ${d.reason}` : ""}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(d.id)} aria-label="Quitar">
                        <Trash size={13} />
                    </button>
                </div>
            ))}
            <form onSubmit={handleSubmit} className="inline-form">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                <label>
                    <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Cerrado
                    todo el día
                </label>
                {!closed && (
                    <>
                        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </>
                )}
                <input placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button className="btn btn-primary btn-sm" type="submit" disabled={loading || !date}>
                    {loading ? "Guardando..." : "Agregar"}
                </button>
            </form>
            {error && <p className="error">{error}</p>}
        </div>
    );
}

function BlockedSlotsEditor({ storeId, storeTimezone }: { storeId: string; storeTimezone: string }) {
    const [blocks, setBlocks] = useState<BlockedSlot[] | null>(null);
    const [date, setDate] = useState("");
    const [startTime, setStartTime] = useState("09:00");
    const [endTime, setEndTime] = useState("10:00");
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    function load() {
        api.get<BlockedSlot[]>(`/stores/${storeId}/blocked-slots`).then(setBlocks).catch(() => {});
    }

    useEffect(load, [storeId]);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await api.post(`/stores/${storeId}/blocked-slots`, {
                date,
                start_time: startTime,
                end_time: endTime,
                reason: reason || undefined,
            });
            setDate("");
            setReason("");
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo guardar el bloqueo");
        } finally {
            setLoading(false);
        }
    }

    async function remove(id: string) {
        await api.delete(`/stores/${storeId}/blocked-slots/${id}`);
        load();
    }

    return (
        <div>
            <h3>Bloqueos puntuales</h3>
            {blocks?.map((b) => (
                <div className="appointment-row" key={b.id}>
                    <span>
                        {formatDateTime(b.starts_at, storeTimezone)}–{formatTime(b.ends_at, storeTimezone)}
                        {b.reason ? ` · ${b.reason}` : ""}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(b.id)} aria-label="Quitar">
                        <Trash size={13} />
                    </button>
                </div>
            ))}
            <form onSubmit={handleSubmit} className="inline-form">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                <input placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button className="btn btn-primary btn-sm" type="submit" disabled={loading || !date}>
                    {loading ? "Guardando..." : "Bloquear"}
                </button>
            </form>
            {error && <p className="error">{error}</p>}
        </div>
    );
}

function ServicesManager({ storeId, allowDeposits }: { storeId: string; allowDeposits: boolean }) {
    const [services, setServices] = useState<Service[] | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [form, setForm] = useState({
        name: "",
        description: "",
        price: "",
        duration_minutes: "30",
        buffer_minutes: "0",
        capacity: "1",
        category_id: "",
        deposit_amount: "",
    });
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
                deposit_amount: allowDeposits && form.deposit_amount ? Number(form.deposit_amount) : undefined,
            });
            setForm({
                name: "",
                description: "",
                price: "",
                duration_minutes: "30",
                buffer_minutes: "0",
                capacity: "1",
                category_id: "",
                deposit_amount: "",
            });
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
                <ServiceRow key={s.id} service={s} categories={categories} allowDeposits={allowDeposits} onChanged={load} />
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
                {allowDeposits && (
                    <input
                        placeholder="Anticipo $ (opcional)"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.deposit_amount}
                        onChange={(e) => setForm((f) => ({ ...f, deposit_amount: e.target.value }))}
                    />
                )}
                <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading ? "Agregando..." : "Agregar servicio"}
                </button>
            </form>
            {allowDeposits && (
                <p className="muted">
                    El anticipo es obligatorio para reservar si lo defines: el cliente paga con tarjeta antes de que
                    la cita se confirme.
                </p>
            )}
            {error && <p className="error">{error}</p>}
        </section>
    );
}

function ServiceRow({
    service,
    categories,
    allowDeposits,
    onChanged,
}: {
    service: Service;
    categories: Category[];
    allowDeposits: boolean;
    onChanged: () => void;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: service.name,
        description: service.description || "",
        price: service.price,
        duration_minutes: String(service.duration_minutes || ""),
        buffer_minutes: String(service.buffer_minutes ?? 0),
        capacity: String(service.capacity ?? 1),
        category_id: service.category_id || "",
        deposit_amount: service.deposit_amount || "",
    });

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

    async function save() {
        setSaving(true);
        setError(null);
        try {
            await api.patch(`/services/${service.id}`, {
                name: form.name,
                description: form.description,
                price: Number(form.price),
                duration_minutes: Number(form.duration_minutes),
                buffer_minutes: Number(form.buffer_minutes),
                capacity: Number(form.capacity),
                category_id: form.category_id || null,
                deposit_amount: allowDeposits && form.deposit_amount ? Number(form.deposit_amount) : null,
            });
            setEditing(false);
            onChanged();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo guardar el servicio");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="service-row">
            {editing ? (
                <div className="inline-form">
                    <input
                        placeholder="Nombre"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                    <input
                        placeholder="Descripción"
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    />
                    <select
                        value={form.category_id}
                        onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                    >
                        <option value="">Sin categoría</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                    <input
                        placeholder="Precio"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.price}
                        onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    />
                    <input
                        placeholder="Duración (min)"
                        type="number"
                        min="1"
                        value={form.duration_minutes}
                        onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                    />
                    <input
                        placeholder="Colchón (min)"
                        type="number"
                        min="0"
                        value={form.buffer_minutes}
                        onChange={(e) => setForm((f) => ({ ...f, buffer_minutes: e.target.value }))}
                    />
                    <input
                        placeholder="Capacidad"
                        type="number"
                        min="1"
                        value={form.capacity}
                        onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                    />
                    {allowDeposits && (
                        <input
                            placeholder="Anticipo $ (opcional)"
                            type="number"
                            min="0"
                            step="0.01"
                            value={form.deposit_amount}
                            onChange={(e) => setForm((f) => ({ ...f, deposit_amount: e.target.value }))}
                        />
                    )}
                    <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                        {saving ? "Guardando..." : "Guardar"}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={saving}>
                        Cancelar
                    </button>
                </div>
            ) : (
                <>
                    <strong>{service.name}</strong> · ${service.price} · {service.duration_minutes} min · capacidad{" "}
                    {service.capacity}
                    {!!service.deposit_amount && Number(service.deposit_amount) > 0 && (
                        <> · anticipo ${service.deposit_amount}</>
                    )}{" "}
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                        Editar
                    </button>
                </>
            )}
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
    const [chatAppointment, setChatAppointment] = useState<Appointment | null>(null);

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
                        <div className="inline-form">
                            <button className="btn btn-ghost btn-sm" onClick={() => setChatAppointment(a)}>
                                <ChatCircle size={14} /> Chat
                            </button>
                            <select
                                value={a.status}
                                onChange={(e) => changeStatus(a.id, e.target.value as Appointment["status"])}
                                disabled={APPOINTMENT_NEXT_STATUSES[a.status].length === 0}
                            >
                                <option value={a.status}>{a.status}</option>
                                {APPOINTMENT_NEXT_STATUSES[a.status].map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                ))
            )}
            {chatAppointment && (
                <ChatPanel
                    endpoint={`/appointments/${chatAppointment.id}/messages`}
                    title={chatAppointment.service_name ?? "Chat"}
                    onClose={() => setChatAppointment(null)}
                />
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
                <ProductRow key={p.id} product={p} categories={categories} onChanged={load} />
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

function ProductRow({
    product,
    categories,
    onChanged,
}: {
    product: Product;
    categories: Category[];
    onChanged: () => void;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: product.name,
        description: product.description || "",
        price: product.price,
        stock: String(product.stock ?? 0),
        category_id: product.category_id || "",
    });

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

    async function save() {
        setSaving(true);
        setError(null);
        try {
            await api.patch(`/products/${product.id}`, {
                name: form.name,
                description: form.description,
                price: Number(form.price),
                stock: Number(form.stock),
                category_id: form.category_id || null,
            });
            setEditing(false);
            onChanged();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo guardar el producto");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="service-row">
            {editing ? (
                <div className="inline-form">
                    <input
                        placeholder="Nombre"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                    <input
                        placeholder="Descripción"
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    />
                    <select
                        value={form.category_id}
                        onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                    >
                        <option value="">Sin categoría</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                    <input
                        placeholder="Precio"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.price}
                        onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    />
                    <input
                        placeholder="Inventario"
                        type="number"
                        min="0"
                        value={form.stock}
                        onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                    />
                    <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                        {saving ? "Guardando..." : "Guardar"}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={saving}>
                        Cancelar
                    </button>
                </div>
            ) : (
                <>
                    <strong>{product.name}</strong> · ${product.price} · {product.stock} en inventario{" "}
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                        Editar
                    </button>
                </>
            )}
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

// El ciclo de vida de un pedido solo avanza (ver ALLOWED_TRANSITIONS en
// orders.controller.js) -- el select solo debe ofrecer las opciones que el
// backend de verdad va a aceptar, para no dejar al dueño elegir un estado
// que después va a rechazar con un error confuso.
const ORDER_NEXT_STATUSES: Record<Order["status"], Order["status"][]> = {
    pendiente: ["pagado", "cancelado"],
    pagado: ["entregado", "cancelado"],
    entregado: [],
    cancelado: [],
};

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
                            Folio {orderFolio(o.id)} · {o.items.map((it) => `${it.quantity}× ${it.name}`).join(", ")} · $
                            {o.total_amount} · {o.customer_name || o.customer_email}
                        </span>
                        <select
                            value={o.status}
                            onChange={(e) => changeStatus(o.id, e.target.value as Order["status"])}
                            disabled={ORDER_NEXT_STATUSES[o.status].length === 0}
                        >
                            <option value={o.status}>{o.status}</option>
                            {ORDER_NEXT_STATUSES[o.status].map((s) => (
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
