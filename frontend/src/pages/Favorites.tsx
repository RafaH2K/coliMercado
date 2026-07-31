import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HeartBreak, MapPin } from "@phosphor-icons/react";
import { api, ApiError, imageUrl } from "../lib/api";
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
    if (!stores) return <p className="muted">Cargando...</p>;

    return (
        <div>
            <h1>Mis favoritos</h1>
            {stores.length === 0 ? (
                <p className="muted">Todavía no tienes negocios favoritos.</p>
            ) : (
                <div className="grid">
                    {stores.map((store) => (
                        <div className="card" key={store.id}>
                            {store.logo_url && (
                                <img src={imageUrl(store.logo_url)!} alt="" className="store-logo" />
                            )}
                            <Link to={`/negocios/${store.id}`}>
                                <h3>{store.name}</h3>
                            </Link>
                            {store.city && (
                                <p className="muted" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <MapPin size={13} /> {store.city}
                                </p>
                            )}
                            <button className="btn btn-ghost btn-sm" onClick={() => remove(store.id)}>
                                <HeartBreak size={14} /> Quitar de favoritos
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
