import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { Store } from "../types";

export default function Favorites() {
    const [stores, setStores] = useState<Store[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    function load() {
        api
            .get<Store[]>("/favorites")
            .then(setStores)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar tus favoritos"));
    }

    useEffect(load, []);

    async function remove(storeId: string) {
        await api.delete(`/favorites/${storeId}`);
        load();
    }

    if (error) return <p className="error">{error}</p>;
    if (!stores) return <p>Cargando...</p>;
    if (stores.length === 0) return <p>Todavía no tienes negocios favoritos.</p>;

    return (
        <div>
            <h1>Mis favoritos</h1>
            <div className="grid">
                {stores.map((store) => (
                    <div className="card" key={store.id}>
                        <Link to={`/negocios/${store.id}`}>
                            <h2>{store.name}</h2>
                        </Link>
                        {store.city && <p className="muted">{store.city}</p>}
                        <button className="btn btn-ghost" onClick={() => remove(store.id)}>
                            Quitar de favoritos
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
