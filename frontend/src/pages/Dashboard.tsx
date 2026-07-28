import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Appointment, BusinessHour, Service, Store } from "../types";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const STATUSES: Appointment["status"][] = ["pendiente", "confirmada", "completada", "no_asistio", "cancelada"];
const TIMEZONES: string[] =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/Mexico_City"];
const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

type DayRow = { enabled: boolean; start_time: string; end_time: string };

function emptyWeek(): DayRow[] {
    return DAYS.map(() => ({ enabled: false, start_time: "09:00", end_time: "18:00" }));
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
    const [timezone, setTimezone] = useState(BROWSER_TIMEZONE);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const store = await api.post<Store>("/stores", { name, description, city, timezone });
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

function StorePanel({ store }: { store: Store }) {
    return (
        <div>
            <h1>{store.name}</h1>
            <p className="muted">Zona horaria: {store.timezone}</p>
            <BusinessHoursEditor storeId={store.id} />
            <ServicesManager storeId={store.id} />
            <AppointmentsManager storeId={store.id} storeTimezone={store.timezone} />
        </div>
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
    const [form, setForm] = useState({ name: "", description: "", price: "", duration_minutes: "30", buffer_minutes: "0", capacity: "1" });
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    function load() {
        api.get<Service[]>(`/stores/${storeId}/services`).then(setServices);
    }

    useEffect(load, [storeId]);

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
            });
            setForm({ name: "", description: "", price: "", duration_minutes: "30", buffer_minutes: "0", capacity: "1" });
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
                <div className="service-row" key={s.id}>
                    <strong>{s.name}</strong> · ${s.price} · {s.duration_minutes} min · capacidad {s.capacity}
                </div>
            ))}

            <form onSubmit={handleSubmit} className="inline-form">
                <input placeholder="Nombre" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                <input placeholder="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
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
                            {a.service_name} · {formatDateTime(a.starts_at, storeTimezone)} ·{" "}
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
