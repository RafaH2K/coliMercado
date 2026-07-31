import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";

export default function ForgotPassword() {
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const res = await api.post<{ message: string }>("/auth/forgot-password", { email });
            setMessage(res.message);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo procesar la solicitud");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="card form-card">
            <h1>Recuperar contraseña</h1>
            {message ? (
                <p className="card success">{message}</p>
            ) : (
                <form onSubmit={handleSubmit}>
                    <label className="field">
                        Email
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </label>
                    {error && <p className="error">{error}</p>}
                    <button className="btn btn-primary" type="submit" disabled={loading}>
                        {loading ? "Enviando..." : "Enviar instrucciones"}
                    </button>
                </form>
            )}
            <p>
                <Link to="/login">Volver a iniciar sesión</Link>
            </p>
        </div>
    );
}
