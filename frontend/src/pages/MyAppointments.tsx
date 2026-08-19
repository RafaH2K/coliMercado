import { useEffect, useState } from "react";
import { CalendarBlank, ChatCircle, UsersThree, XCircle } from "@phosphor-icons/react";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Appointment } from "../types";
import ChatPanel from "../components/ChatPanel";

const CANCELABLE: Appointment["status"][] = ["pendiente", "confirmada"];

export default function MyAppointments() {
    const [appointments, setAppointments] = useState<Appointment[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chatAppointment, setChatAppointment] = useState<Appointment | null>(null);

    function load() {
        api
            .get<Appointment[]>("/appointments/me")
            .then(setAppointments)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar tus citas"));
    }

    useEffect(load, []);

    // Si volvemos de Mercado Pago con ?payment_id=...&external_reference=...
    // (los agrega MP solo, no el frontend), confirma la cita al instante --
    // el webhook la activa de todos modos si el cliente nunca vuelve.
    useEffect(() => {
        const url = new URLSearchParams(window.location.search);
        const paymentId = url.get("payment_id");
        const externalReference = url.get("external_reference");
        if (!paymentId || !externalReference) return;
        api
            .post(`/appointments/mercadopago/deposit/confirm`, { payment_id: paymentId, external_reference: externalReference })
            .then(load)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo confirmar el anticipo"))
            .finally(() => window.history.replaceState({}, "", "/mis-citas"));
    }, []);

    async function cancel(id: string) {
        try {
            await api.patch(`/appointments/${id}/status`, { status: "cancelada" });
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo cancelar la cita");
        }
    }

    if (error) return <p className="error">{error}</p>;
    if (!appointments) return <p className="muted">Cargando...</p>;

    return (
        <div>
            <h1>Mis citas</h1>
            {appointments.length === 0 ? (
                <p className="muted">Todavía no tienes citas reservadas.</p>
            ) : (
                <div className="grid">
                    {appointments.map((a) => (
                        <div className="card" key={a.id}>
                            <h3>{a.service_name}</h3>
                            <p className="muted" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <CalendarBlank size={14} /> {formatDateTime(a.starts_at, a.store_timezone)}
                            </p>
                            {!!a.party_size && (
                                <p className="muted" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <UsersThree size={14} /> {a.party_size} personas
                                </p>
                            )}
                            <p className={`badge badge-${a.status}`}>{a.status}</p>
                            <div className="store-actions">
                                <button className="btn btn-ghost btn-sm" onClick={() => setChatAppointment(a)}>
                                    <ChatCircle size={14} /> Chat
                                </button>
                                {CANCELABLE.includes(a.status) && (
                                    <button className="btn btn-ghost btn-sm" onClick={() => cancel(a.id)}>
                                        <XCircle size={14} /> Cancelar
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {chatAppointment && (
                <ChatPanel
                    endpoint={`/appointments/${chatAppointment.id}/messages`}
                    title={chatAppointment.service_name ?? "Chat"}
                    onClose={() => setChatAppointment(null)}
                />
            )}
        </div>
    );
}
