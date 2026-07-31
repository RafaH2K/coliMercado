import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, imageUrl } from "../lib/api";
import { useDebouncedFilters } from "../lib/useDebouncedFilters";
import { SearchFilters } from "../components/SearchFilters";
import type { Category, Product } from "../types";

export default function Marketplace() {
    const [products, setProducts] = useState<Product[] | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [error, setError] = useState<string | null>(null);
    const filters = useDebouncedFilters();

    useEffect(() => {
        api.get<Category[]>("/categories?kind=product").then(setCategories).catch(() => {});
    }, []);

    useEffect(() => {
        api
            .get<Product[]>(`/products${filters.qs ? `?${filters.qs}` : ""}`)
            .then(setProducts)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar los productos"));
    }, [filters.qs]);

    return (
        <div>
            <div className="page-header">
                <h1>Mercado</h1>
                <p>Productos de negocios locales: cómpralos aquí y coordina la entrega directo con cada uno.</p>
            </div>
            <SearchFilters {...filters} categories={categories} placeholder="Buscar productos..." />

            {error && <p className="error">{error}</p>}
            {!products ? (
                <p className="muted">Cargando productos...</p>
            ) : products.length === 0 ? (
                <p className="muted">No hay productos que coincidan con tu búsqueda.</p>
            ) : (
                <div className="grid">
                    {products.map((product) => (
                        <Link to={`/productos/${product.id}`} key={product.id} className="card">
                            {product.images?.[0] && (
                                <img src={imageUrl(product.images[0].url)!} alt="" className="service-thumb" />
                            )}
                            <h3>{product.name}</h3>
                            <p className="muted">{product.store_name}</p>
                            <p className="price">${product.price}</p>
                            <p className="muted">{product.stock === 0 ? "Agotado" : `${product.stock} disponibles`}</p>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
