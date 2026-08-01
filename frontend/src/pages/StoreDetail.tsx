import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Heart, MapPin, Phone, Star, WhatsappLogo } from "@phosphor-icons/react";
import { api, ApiError, imageUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { BusinessHour, Product, Review, Service, Store } from "../types";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function Stars({ n }: { n: number }) {
    return (
        <span className="rating">
            {Array.from({ length: 5 }, (_, i) => (
                <Star key={i} weight={i < n ? "fill" : "regular"} size={14} />
            ))}
        </span>
    );
}

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
            <Heart weight={isFavorite ? "fill" : "regular"} size={16} color={isFavorite ? "var(--danger)" : undefined} />
            {isFavorite ? "En favoritos" : "Agregar a favoritos"}
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
                                {n} estrella{n > 1 ? "s" : ""}
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
                <p className="muted">Cargando reseñas...</p>
            ) : reviews.length === 0 ? (
                <p className="muted">Todavía no hay reseñas.</p>
            ) : (
                <div className="review-list">
                    {reviews.map((r) => (
                        <div className="card" key={r.id}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <Stars n={r.rating} />
                                <span className="muted">{r.customer_name}</span>
                            </div>
                            {r.comment && <p style={{ marginTop: 8 }}>{r.comment}</p>}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

function BusinessHoursDisplay({ storeId }: { storeId: string }) {
    const [hours, setHours] = useState<BusinessHour[] | null>(null);

    useEffect(() => {
        api
            .get<BusinessHour[]>(`/stores/${storeId}/business-hours`)
            .then(setHours)
            .catch(() => setHours([]));
    }, [storeId]);

    if (!hours || hours.length === 0) return null;

    return (
        <div className="business-hours">
            <h3>Horario</h3>
            {DAYS.map((day, dayIndex) => {
                const ranges = hours.filter((h) => h.day_of_week === dayIndex);
                if (ranges.length === 0) return null;
                return (
                    <p key={dayIndex} className="business-hours-row">
                        <span>{day}</span>
                        <span>{ranges.map((r) => `${r.start_time.slice(0, 5)} - ${r.end_time.slice(0, 5)}`).join(", ")}</span>
                    </p>
                );
            })}
        </div>
    );
}

function ContactButtons({ phone }: { phone: string | null }) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, ""); // wa.me necesita solo dígitos, con código de país
    return (
        <div className="inline-form">
            <a className="btn" href={`tel:${phone}`}>
                <Phone size={16} /> Llamar
            </a>
            <a className="btn btn-primary" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">
                <WhatsappLogo weight="fill" size={16} /> WhatsApp
            </a>
        </div>
    );
}

export default function StoreDetail() {
    const { storeId } = useParams<{ storeId: string }>();
    const [store, setStore] = useState<Store | null>(null);
    const [services, setServices] = useState<Service[] | null>(null);
    const [products, setProducts] = useState<Product[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!storeId) return;
        Promise.all([
            api.get<Store>(`/stores/${storeId}`),
            api.get<Service[]>(`/stores/${storeId}/services`),
            api.get<Product[]>(`/stores/${storeId}/products`),
        ])
            .then(([store, services, products]) => {
                setStore(store);
                setServices(services);
                setProducts(products);
            })
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el negocio"));
    }, [storeId]);

    if (error) return <p className="error">{error}</p>;
    if (!store || !services || !products) return <p className="muted">Cargando...</p>;

    return (
        <div>
            <div className="store-hero">
                {store.logo_url && <img src={imageUrl(store.logo_url)!} alt="" className="store-logo-large" />}
                <div>
                    <h1>{store.name}</h1>
                    {store.city && (
                        <p className="muted" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <MapPin size={14} /> {store.city}
                        </p>
                    )}
                    {store.description && <p>{store.description}</p>}
                    {!!store.review_count && <Rating avg={store.avg_rating} count={store.review_count} />}
                    <div className="store-actions">
                        <ContactButtons phone={store.phone} />
                        <FavoriteButton storeId={store.id} />
                    </div>
                    <BusinessHoursDisplay storeId={store.id} />
                </div>
            </div>

            <h2>Servicios</h2>
            {services.length === 0 ? (
                <p className="muted">Este negocio todavía no publica servicios reservables.</p>
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

            {products.length > 0 && (
                <>
                    <h2>Productos</h2>
                    <div className="grid">
                        {products.map((product) => (
                            <Link to={`/productos/${product.id}`} key={product.id} className="card">
                                {product.images?.[0] && (
                                    <img src={imageUrl(product.images[0].url)!} alt="" className="service-thumb" />
                                )}
                                <h3>{product.name}</h3>
                                {product.description && <p>{product.description}</p>}
                                <p className="price">${product.price}</p>
                                <p className="muted">{product.stock === 0 ? "Agotado" : `${product.stock} disponibles`}</p>
                            </Link>
                        ))}
                    </div>
                </>
            )}

            <ReviewsSection storeId={store.id} />
        </div>
    );
}

function Rating({ avg, count }: { avg?: number; count?: number }) {
    return (
        <span className="rating" style={{ marginBottom: 8 }}>
            <Star weight="fill" size={14} />
            {avg?.toFixed(1)} ({count} reseñas)
        </span>
    );
}
