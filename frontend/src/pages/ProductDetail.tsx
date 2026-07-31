import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ShoppingCartSimple } from "@phosphor-icons/react";
import { api, ApiError, imageUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Product } from "../types";

export default function ProductDetail() {
    const { productId } = useParams<{ productId: string }>();
    const { user } = useAuth();

    const [product, setProduct] = useState<Product | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [added, setAdded] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!productId) return;
        api
            .get<Product>(`/products/${productId}`)
            .then(setProduct)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el producto"));
    }, [productId]);

    async function addToCart() {
        if (!productId) return;
        setLoading(true);
        setError(null);
        setAdded(false);
        try {
            await api.post("/cart", { product_id: productId, quantity });
            setAdded(true);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo agregar al carrito");
        } finally {
            setLoading(false);
        }
    }

    if (error && !product) return <p className="error">{error}</p>;
    if (!product) return <p className="muted">Cargando...</p>;

    const outOfStock = product.stock === 0;
    const [hero, ...rest] = product.images ?? [];

    return (
        <div>
            {hero && (
                <div className="service-gallery">
                    <img src={imageUrl(hero.url)!} alt="" className="service-hero-img" />
                    {rest.length > 0 && (
                        <div className="gallery">
                            {rest.map((img) => (
                                <img key={img.id} src={imageUrl(img.url)!} alt="" />
                            ))}
                        </div>
                    )}
                </div>
            )}
            <h1>{product.name}</h1>
            {product.store_name && <p className="muted">{product.store_name}</p>}
            {product.description && <p>{product.description}</p>}
            <p className="price">${product.price}</p>
            <p className="muted">{outOfStock ? "Agotado" : `${product.stock} disponibles`}</p>

            {added && (
                <div className="card success">
                    <p>Agregado al carrito.</p>
                    <Link to="/carrito">Ver carrito</Link>
                </div>
            )}
            {error && <p className="error">{error}</p>}

            {!user ? (
                <p>
                    <Link to="/login">Inicia sesión</Link> para comprar este producto.
                </p>
            ) : (
                !outOfStock && (
                    <div className="inline-form">
                        <input
                            type="number"
                            min={1}
                            max={product.stock ?? undefined}
                            value={quantity}
                            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                            style={{ width: 80 }}
                        />
                        <button className="btn btn-primary" onClick={addToCart} disabled={loading}>
                            <ShoppingCartSimple size={16} weight="bold" />
                            {loading ? "Agregando..." : "Agregar al carrito"}
                        </button>
                    </div>
                )
            )}
        </div>
    );
}
