import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, imageUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Review, Service, Store } from "../types";

function FavoriteButton({ storeId }: { storeId: string }) {
    const { user } = useAuth();
    const [isFavorite, setIsFavorite] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!user) return;
        api
            .get<Store[]>("/favorites")
            .then((favs) => setIsFavorite(favs.some((s) => s.id === storeId)))
            .catch(() => {});
    }, [user, storeId]);

    if (!user) return null;

    async function toggle() {
        setLoading(true);
        try {
            if (isFavorite) {
                await api.delete(`/favorites/${storeId}`);
            } else {
                await api.post("/favorites", { store_id: storeId });
            }
            setIsFavorite((v) => !v);
        } catch {
            // deja el estado como estaba si falla
        } finally {
            setLoading(false);
        }
    }

    return (
        <button className="btn btn-ghost" onClick={toggle} disabled={loading}>
            {isFavorite ? "♥ En favoritos" : "♡ Agregar a favoritos"}
        </button>
    );
}

function ReviewsSection({ storeId }: { storeId: string }) {
    const { user } = useAuth();
    const [reviews, setReviews] = useState<Review[] | null>(null);
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    function load() {
        api.get<Review[]>(`/stores/${storeId}/reviews`).then(setReviews);
    }

    useEffect(load, [storeId]);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await api.post(`/stores/${storeId}/reviews`, { rating, comment });
            setComment("");
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo guardar la reseña");
        } finally {
            setLoading(false);
        }
    }

    return (
        <section>
            <h2>Reseñas</h2>
            {user && (
                <form onSubmit={handleSubmit} className="inline-form">
                    <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                        {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>
                                {"★".repeat(n)}
                            </option>
                        ))}
                    </select>
                    <input placeholder="Comentario (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                    <button className="btn btn-primary" type="submit" disabled={loading}>
                        {loading ? "Guardando..." : "Dejar reseña"}
                    </button>
                </form>
            )}
            {error && <p className="error">{error}</p>}
            {!reviews ? (
                <p>Cargando reseñas...</p>
            ) : reviews.length === 0 ? (
                <p className="muted">Todavía no hay reseñas.</p>
            ) : (
                reviews.map((r) => (
                    <div className="card" key={r.id} style={{ marginBottom: 8 }}>
                        <strong>{"★".repeat(r.rating)}</strong> · {r.customer_name}
                        {r.comment && <p>{r.comment}</p>}
                    </div>
                ))
            )}
        </section>
    );
}

function ContactButtons({ phone }: { phone: string | null }) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, ""); // wa.me necesita solo dígitos, con código de país
    return (
        <div className="inline-form">
            <a className="btn" href={`tel:${phone}`}>
                Llamar
            </a>
            <a className="btn btn-primary" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">
                WhatsApp
            </a>
        </div>
    );
}

export default function StoreDetail() {
    const { storeId } = useParams<{ storeId: string }>();
    const [store, setStore] = useState<Store | null>(null);
    const [services, setServices] = useState<Service[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!storeId) return;
        Promise.all([api.get<Store>(`/stores/${storeId}`), api.get<Service[]>(`/stores/${storeId}/services`)])
            .then(([store, services]) => {
                setStore(store);
                setServices(services);
            })
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el negocio"));
    }, [storeId]);

    if (error) return <p className="error">{error}</p>;
    if (!store || !services) return <p>Cargando...</p>;

    return (
        <div>
            {store.logo_url && <img src={imageUrl(store.logo_url)!} alt="" className="store-logo-large" />}
            <h1>{store.name}</h1>
            {store.city && <p className="muted">{store.city}</p>}
            {store.description && <p>{store.description}</p>}
            {!!store.review_count && (
                <p>
                    ★ {store.avg_rating?.toFixed(1)} ({store.review_count} reseñas)
                </p>
            )}
            <ContactButtons phone={store.phone} />
            <FavoriteButton storeId={store.id} />

            <h2>Servicios</h2>
            {services.length === 0 ? (
                <p>Este negocio todavía no publica servicios reservables.</p>
            ) : (
                <div className="grid">
                    {services.map((service) => (
                        <Link to={`/servicios/${service.id}`} key={service.id} className="card">
                            {service.images?.[0] && (
                                <img src={imageUrl(service.images[0].url)!} alt="" className="service-thumb" />
                            )}
                            <h3>{service.name}</h3>
                            {service.description && <p>{service.description}</p>}
                            <p className="price">${service.price}</p>
                            {service.duration_minutes && <p className="muted">{service.duration_minutes} min</p>}
                        </Link>
                    ))}
                </div>
            )}

            <ReviewsSection storeId={store.id} />
        </div>
    );
}
