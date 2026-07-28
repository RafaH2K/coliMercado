import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, imageUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, formatTime } from "../lib/format";
import type { Appointment, Service, Slot } from "../types";

// Fecha local del navegador, no UTC (toISOString() da la fecha en UTC y
// puede mostrar "mañana" si ya cruzó medianoche UTC pero no la local).
function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ServiceDetail() {
    const { serviceId } = useParams<{ serviceId: string }>();
    const { user } = useAuth();

    const [service, setService] = useState<Service | null>(null);
    const [date, setDate] = useState(todayISO());
    const [slots, setSlots] = useState<Slot[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [booking, setBooking] = useState<string | null>(null); // starts_at siendo reservado
    const [confirmed, setConfirmed] = useState<Appointment | null>(null);

    useEffect(() => {
        if (!serviceId) return;
        api
            .get<Service>(`/services/${serviceId}`)
            .then(setService)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el servicio"));
    }, [serviceId]);

    useEffect(() => {
        if (!serviceId || !date) return;
        setSlots(null);
        api
            .get<{ slots: Slot[] }>(`/services/${serviceId}/availability?date=${date}`)
            .then((r) => setSlots(r.slots))
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la disponibilidad"));
    }, [serviceId, date]);

    async function book(slot: Slot) {
        if (!serviceId) return;
        setBooking(slot.starts_at);
        setError(null);
        try {
            const appointment = await api.post<Appointment>("/appointments", {
                product_id: serviceId,
                starts_at: slot.starts_at,
            });
            setConfirmed(appointment);
            setSlots((prev) => prev && prev.filter((s) => s.starts_at !== slot.starts_at));
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo reservar ese horario");
        } finally {
            setBooking(null);
        }
    }

    if (error && !service) return <p className="error">{error}</p>;
    if (!service) return <p>Cargando...</p>;

    return (
        <div>
            {!!service.images?.length && (
                <div className="gallery">
                    {service.images.map((img) => (
                        <img key={img.id} src={imageUrl(img.url)!} alt="" />
                    ))}
                </div>
            )}
            <h1>{service.name}</h1>
            {service.description && <p>{service.description}</p>}
            <p className="price">
                ${service.price} · {service.duration_minutes} min
            </p>

            {confirmed && (
                <div className="card success">
                    <p>
                        Cita reservada para {formatDateTime(confirmed.starts_at, service.store_timezone)} (hora del
                        negocio). Estado: {confirmed.status}.
                    </p>
                    <Link to="/mis-citas">Ver mis citas</Link>
                </div>
            )}

            {!user ? (
                <p>
                    <Link to="/login">Inicia sesión</Link> para reservar este servicio.
                </p>
            ) : (
                <div className="booking">
                    <label className="field">
                        Fecha
                        <input
                            type="date"
                            value={date}
                            min={todayISO()}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </label>
                    {service.store_timezone && <p className="muted">Horarios en {service.store_timezone}</p>}

                    {error && <p className="error">{error}</p>}

                    {!slots ? (
                        <p>Buscando horarios disponibles...</p>
                    ) : slots.length === 0 ? (
                        <p>No hay horarios disponibles ese día.</p>
                    ) : (
                        <div className="slots">
                            {slots.map((slot) => (
                                <button
                                    key={slot.starts_at}
                                    className="btn slot-btn"
                                    disabled={booking === slot.starts_at}
                                    onClick={() => book(slot)}
                                >
                                    {formatTime(slot.starts_at, service.store_timezone)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
