import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export default function Register() {
    const { register } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    function update(field: keyof typeof form) {
        return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [field]: e.target.value }));
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await register(form);
            navigate("/");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo crear la cuenta");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="card form-card">
            <h1>Crear cuenta</h1>
            <form onSubmit={handleSubmit}>
                <label className="field">
                    Nombre
                    <input value={form.name} onChange={update("name")} required />
                </label>
                <label className="field">
                    Email
                    <input type="email" value={form.email} onChange={update("email")} required />
                </label>
                <label className="field">
                    Teléfono
                    <input value={form.phone} onChange={update("phone")} />
                </label>
                <label className="field">
                    Contraseña
                    <input type="password" value={form.password} onChange={update("password")} required minLength={8} />
                </label>
                {error && <p className="error">{error}</p>}
                <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading ? "Creando..." : "Crear cuenta"}
                </button>
            </form>
            <p>
                ¿Ya tienes cuenta? <Link to="/login">Entra aquí</Link>
            </p>
        </div>
    );
}
