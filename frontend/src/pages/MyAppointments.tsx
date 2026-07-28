import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Appointment } from "../types";

const CANCELABLE: Appointment["status"][] = ["pendiente", "confirmada"];

export default function MyAppointments() {
    const [appointments, setAppointments] = useState<Appointment[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    function load() {
        api
            .get<Appointment[]>("/appointments/me")
            .then(setAppointments)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar tus citas"));
    }

    useEffect(load, []);

    async function cancel(id: string) {
        try {
            await api.patch(`/appointments/${id}/status`, { status: "cancelada" });
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo cancelar la cita");
        }
    }

    if (error) return <p className="error">{error}</p>;
    if (!appointments) return <p>Cargando...</p>;
    if (appointments.length === 0) return <p>Todavía no tienes citas reservadas.</p>;

    return (
        <div>
            <h1>Mis citas</h1>
            <div className="grid">
                {appointments.map((a) => (
                    <div className="card" key={a.id}>
                        <h3>{a.service_name}</h3>
                        <p>{formatDateTime(a.starts_at, a.store_timezone)}</p>
                        <p className={`badge badge-${a.status}`}>{a.status}</p>
                        {CANCELABLE.includes(a.status) && (
                            <button className="btn btn-ghost" onClick={() => cancel(a.id)}>
                                Cancelar
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
