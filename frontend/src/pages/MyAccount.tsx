import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function MyAccount() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleDelete() {
        setDeleting(true);
        setError(null);
        try {
            await api.delete("/auth/me");
            logout();
            navigate("/");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo borrar tu cuenta");
            setDeleting(false);
            setConfirming(false);
        }
    }

    return (
        <div>
            <h1>Mi cuenta</h1>
            <p className="muted">{user?.email}</p>

            <section className="card" style={{ marginTop: 24 }}>
                <h2>Borrar mi cuenta</h2>
                <p className="muted">
                    Esto elimina tus datos personales (nombre, email, teléfono) de forma permanente y no se puede
                    deshacer. Si tienes un negocio o permisos de administrador, contáctanos primero para gestionar
                    ese cierre antes de borrar tu cuenta.
                </p>
                {error && <p className="error">{error}</p>}
                {!confirming ? (
                    <button className="btn btn-ghost" onClick={() => setConfirming(true)}>
                        Borrar mi cuenta
                    </button>
                ) : (
                    <div className="inline-form">
                        <span>¿Seguro? Esta acción no se puede deshacer.</span>
                        <button className="btn btn-primary" onClick={handleDelete} disabled={deleting}>
                            {deleting ? "Borrando..." : "Sí, borrar mi cuenta"}
                        </button>
                        <button className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={deleting}>
                            Cancelar
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}
