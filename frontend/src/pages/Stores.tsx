import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Star, MapPin } from "@phosphor-icons/react";
import { api, ApiError, imageUrl } from "../lib/api";
import { useDebouncedFilters } from "../lib/useDebouncedFilters";
import { SearchFilters } from "../components/SearchFilters";
import type { Category, Service, Store } from "../types";

function Rating({ avg, count }: { avg?: number; count?: number }) {
    if (!count) return <p className="muted">Sin reseñas todavía</p>;
    return (
        <span className="rating">
            <Star weight="fill" size={14} />
            {avg?.toFixed(1)} ({count})
        </span>
    );
}

type View = "negocios" | "servicios";

export default function Stores() {
    const [view, setView] = useState<View>("negocios");
    const [stores, setStores] = useState<Store[] | null>(null);
    const [services, setServices] = useState<Service[] | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [error, setError] = useState<string | null>(null);
    const filters = useDebouncedFilters();

    useEffect(() => {
        api.get<Category[]>("/categories?kind=service").then(setCategories).catch(() => {});
    }, []);

    useEffect(() => {
        if (view === "negocios") {
            api
                .get<Store[]>(`/stores${filters.qs ? `?${filters.qs}` : ""}`)
                .then(setStores)
                .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar los negocios"));
        } else {
            api
                .get<Service[]>(`/services${filters.qs ? `?${filters.qs}` : ""}`)
                .then(setServices)
                .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar los servicios"));
        }
    }, [view, filters.qs]);

    return (
        <div>
            <div className="page-header">
                <h1>Negocios y reservaciones</h1>
                <p>Explora negocios locales o busca directo el servicio que quieres reservar.</p>
            </div>

            <div className="view-toggle">
                <button
                    className={`btn btn-sm ${view === "negocios" ? "btn-primary" : ""}`}
                    onClick={() => setView("negocios")}
                >
                    Negocios
                </button>
                <button
                    className={`btn btn-sm ${view === "servicios" ? "btn-primary" : ""}`}
                    onClick={() => setView("servicios")}
                >
                    Servicios
                </button>
            </div>

            <SearchFilters
                {...filters}
                categories={categories}
                placeholder={view === "negocios" ? "Buscar por nombre..." : "Buscar servicios..."}
            />

            {error && <p className="error">{error}</p>}

            {view === "negocios" ? (
                !stores ? (
                    <p className="muted">Cargando negocios...</p>
                ) : stores.length === 0 ? (
                    <p className="muted">No hay negocios que coincidan con tu búsqueda.</p>
                ) : (
                    <div className="grid">
                        {stores.map((store) => (
                            <Link to={`/negocios/${store.id}`} key={store.id} className="card store-card">
                                {store.logo_url && (
                                    <img src={imageUrl(store.logo_url)!} alt="" className="store-logo" />
                                )}
                                <h3>{store.name}</h3>
                                {store.city && (
                                    <p className="muted" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <MapPin size={13} /> {store.city}
                                    </p>
                                )}
                                {store.description && <p>{store.description}</p>}
                                <Rating avg={store.avg_rating} count={store.review_count} />
                            </Link>
                        ))}
                    </div>
                )
            ) : !services ? (
                <p className="muted">Cargando servicios...</p>
            ) : services.length === 0 ? (
                <p className="muted">No hay servicios que coincidan con tu búsqueda.</p>
            ) : (
                <div className="grid">
                    {services.map((service) => (
                        <Link to={`/servicios/${service.id}`} key={service.id} className="card">
                            {service.images?.[0] && (
                                <img src={imageUrl(service.images[0].url)!} alt="" className="service-thumb" />
                            )}
                            <h3>{service.name}</h3>
                            <p className="muted">{service.store_name}</p>
                            <p className="price" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                ${service.price}
                                {service.duration_minutes && (
                                    <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                        <Clock size={13} /> {service.duration_minutes} min
                                    </span>
                                )}
                            </p>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
