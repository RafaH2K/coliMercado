import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";

export default function ResetPassword() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = params.get("token");

    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!token) return;
        setError(null);
        setLoading(true);
        try {
            await api.post("/auth/reset-password", { token, password });
            navigate("/login");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo actualizar la contraseña");
        } finally {
            setLoading(false);
        }
    }

    if (!token) {
        return (
            <div className="card form-card">
                <p className="error">Este enlace no es válido. Solicita uno nuevo.</p>
                <p>
                    <Link to="/olvide-password">Volver a solicitar</Link>
                </p>
            </div>
        );
    }

    return (
        <div className="card form-card">
            <h1>Nueva contraseña</h1>
            <form onSubmit={handleSubmit}>
                <label className="field">
                    Contraseña nueva
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={8}
                        required
                    />
                </label>
                {error && <p className="error">{error}</p>}
                <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading ? "Guardando..." : "Guardar contraseña"}
                </button>
            </form>
        </div>
    );
}
