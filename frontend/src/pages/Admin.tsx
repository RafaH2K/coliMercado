import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { PendingStore } from "../types";

export default function Admin() {
    const [pending, setPending] = useState<PendingStore[] | null>(null);
    const [approved, setApproved] = useState<PendingStore[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    function loadPending() {
        api
            .get<PendingStore[]>("/admin/stores/pending")
            .then(setPending)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista"));
    }

    function loadApproved() {
        api
            .get<PendingStore[]>("/admin/stores/approved")
            .then(setApproved)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista"));
    }

    useEffect(() => {
        loadPending();
        loadApproved();
    }, []);

    async function approve(id: string) {
        setBusyId(id);
        try {
            await api.post(`/admin/stores/${id}/approve`);
            loadPending();
            loadApproved();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo aprobar el negocio");
        } finally {
            setBusyId(null);
        }
    }

    async function reject(id: string) {
        if (!confirm("¿Rechazar y eliminar este negocio pendiente?")) return;
        setBusyId(id);
        try {
            await api.delete(`/admin/stores/${id}`);
            loadPending();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo rechazar el negocio");
        } finally {
            setBusyId(null);
        }
    }

    async function setActive(id: string, is_active: boolean) {
        setBusyId(id);
        try {
            await api.patch(`/admin/stores/${id}/active`, { is_active });
            loadApproved();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo actualizar el negocio");
        } finally {
            setBusyId(null);
        }
    }

    if (error && !pending && !approved) return <p className="error">{error}</p>;
    if (!pending || !approved) return <p className="muted">Cargando...</p>;

    return (
        <div>
            <div className="page-header">
                <h1>Administración de negocios</h1>
            </div>

            {error && <p className="error">{error}</p>}

            <h2>Pendientes de aprobación</h2>
            <p className="muted">Estos negocios no aparecen en el mercado hasta que los apruebes.</p>
            {pending.length === 0 ? (
                <p className="muted">No hay negocios pendientes.</p>
            ) : (
                <div className="card-stack">
                    {pending.map((s) => (
                        <div className="card" key={s.id}>
                            <h3>{s.name}</h3>
                            <p className="muted">
                                {s.owner_name || s.owner_email} · {s.owner_email}
                                {s.city ? ` · ${s.city}` : ""}
                            </p>
                            {s.description && <p>{s.description}</p>}
                            <div className="inline-form">
                                <button className="btn btn-primary" onClick={() => approve(s.id)} disabled={busyId === s.id}>
                                    Aprobar
                                </button>
                                <button className="btn btn-ghost" onClick={() => reject(s.id)} disabled={busyId === s.id}>
                                    Rechazar
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <h2 style={{ marginTop: 32 }}>Negocios aprobados</h2>
            <p className="muted">Suspende un negocio si necesitas quitarlo temporalmente del mercado.</p>
            {approved.length === 0 ? (
                <p className="muted">Todavía no hay negocios aprobados.</p>
            ) : (
                <div className="card-stack">
                    {approved.map((s) => (
                        <div className="card" key={s.id}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <h3>{s.name}</h3>
                                {!s.is_active && <span className="badge badge-cancelada">Suspendido</span>}
                            </div>
                            <p className="muted">
                                {s.owner_name || s.owner_email} · {s.owner_email}
                                {s.city ? ` · ${s.city}` : ""}
                            </p>
                            <div className="inline-form">
                                {s.is_active ? (
                                    <button className="btn btn-ghost" onClick={() => setActive(s.id, false)} disabled={busyId === s.id}>
                                        Suspender
                                    </button>
                                ) : (
                                    <button className="btn btn-primary" onClick={() => setActive(s.id, true)} disabled={busyId === s.id}>
                                        Reactivar
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
