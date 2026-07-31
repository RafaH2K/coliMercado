import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { PendingStore } from "../types";

export default function Admin() {
    const [stores, setStores] = useState<PendingStore[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    function load() {
        api
            .get<PendingStore[]>("/admin/stores/pending")
            .then(setStores)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista"));
    }

    useEffect(load, []);

    async function approve(id: string) {
        setBusyId(id);
        try {
            await api.post(`/admin/stores/${id}/approve`);
            load();
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
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo rechazar el negocio");
        } finally {
            setBusyId(null);
        }
    }

    if (error && !stores) return <p className="error">{error}</p>;
    if (!stores) return <p className="muted">Cargando...</p>;

    return (
        <div>
            <div className="page-header">
                <h1>Negocios pendientes de aprobación</h1>
                <p>Estos negocios no aparecen en el mercado hasta que los apruebes.</p>
            </div>

            {error && <p className="error">{error}</p>}

            {stores.length === 0 ? (
                <p className="muted">No hay negocios pendientes.</p>
            ) : (
                <div className="card-stack">
                    {stores.map((s) => (
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
        </div>
    );
}
