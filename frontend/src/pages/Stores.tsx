import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, imageUrl } from "../lib/api";
import type { Category, Store } from "../types";

function Rating({ avg, count }: { avg?: number; count?: number }) {
    if (!count) return <p className="muted">Sin reseñas todavía</p>;
    return (
        <p className="muted">
            ★ {avg?.toFixed(1)} ({count})
        </p>
    );
}

export default function Stores() {
    const [stores, setStores] = useState<Store[] | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [error, setError] = useState<string | null>(null);

    const [q, setQ] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const [city, setCity] = useState("");

    useEffect(() => {
        api.get<Category[]>("/categories").then(setCategories).catch(() => {});
    }, []);

    useEffect(() => {
        // Pequeño debounce: no golpear la API en cada tecla.
        const timeout = setTimeout(() => {
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (categoryId) params.set("category_id", categoryId);
            if (city) params.set("city", city);
            const qs = params.toString();

            api
                .get<Store[]>(`/stores${qs ? `?${qs}` : ""}`)
                .then(setStores)
                .catch((err) =>
                    setError(err instanceof ApiError ? err.message : "No se pudieron cargar los negocios")
                );
        }, 300);
        return () => clearTimeout(timeout);
    }, [q, categoryId, city]);

    return (
        <div>
            <h1>Negocios</h1>
            <div className="inline-form">
                <input placeholder="Buscar por nombre..." value={q} onChange={(e) => setQ(e.target.value)} />
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">Todas las categorías</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <input placeholder="Ciudad" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>

            {error && <p className="error">{error}</p>}
            {!stores ? (
                <p>Cargando negocios...</p>
            ) : stores.length === 0 ? (
                <p>No hay negocios que coincidan con tu búsqueda.</p>
            ) : (
                <div className="grid">
                    {stores.map((store) => (
                        <Link to={`/negocios/${store.id}`} key={store.id} className="card store-card">
                            {store.logo_url && (
                                <img src={imageUrl(store.logo_url)!} alt="" className="store-logo" />
                            )}
                            <h2>{store.name}</h2>
                            {store.city && <p className="muted">{store.city}</p>}
                            {store.description && <p>{store.description}</p>}
                            <Rating avg={store.avg_rating} count={store.review_count} />
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
