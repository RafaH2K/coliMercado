import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MapPin } from "@phosphor-icons/react";
import { api, imageUrl } from "../lib/api";
import { useDebouncedFilters } from "../lib/useDebouncedFilters";
import { usePaginatedList } from "../lib/usePaginatedList";
import { SearchFilters } from "../components/SearchFilters";
import type { Category, Product } from "../types";

interface StoreGroup {
    store_id: string;
    store_name: string;
    store_city?: string;
    products: Product[];
}

function groupByStore(products: Product[]): StoreGroup[] {
    const byStore = new Map<string, StoreGroup>();
    for (const p of products) {
        if (!byStore.has(p.store_id)) {
            byStore.set(p.store_id, {
                store_id: p.store_id,
                store_name: p.store_name ?? "Tienda",
                store_city: p.store_city,
                products: [],
            });
        }
        byStore.get(p.store_id)!.products.push(p);
    }
    return [...byStore.values()];
}

export default function Marketplace() {
    const [categories, setCategories] = useState<Category[]>([]);
    const filters = useDebouncedFilters();
    const {
        items: products,
        error,
        hasMore,
        loadingMore,
        loadMore,
    } = usePaginatedList<Product>(
        (page) => api.get(`/products?page=${page}${filters.qs ? `&${filters.qs}` : ""}`),
        [filters.qs]
    );

    useEffect(() => {
        api.get<Category[]>("/categories?kind=product").then(setCategories).catch(() => {});
    }, []);

    const stores = products ? groupByStore(products) : null;

    return (
        <div>
            <div className="page-header">
                <h1>Mercado</h1>
                <p>Negocios locales con productos a la venta: entra a cada tienda para ver su catálogo completo.</p>
            </div>
            <SearchFilters {...filters} categories={categories} placeholder="Buscar productos..." />

            {error && <p className="error">{error}</p>}
            {!stores ? (
                <p className="muted">Cargando productos...</p>
            ) : stores.length === 0 ? (
                <p className="muted">No hay productos que coincidan con tu búsqueda.</p>
            ) : (
                <div className="grid">
                    {stores.map((store) => {
                        const thumb = store.products.find((p) => p.images?.[0])?.images?.[0];
                        return (
                            <Link to={`/negocios/${store.store_id}`} key={store.store_id} className="card store-card">
                                {thumb && <img src={imageUrl(thumb.url)!} alt="" className="store-logo" />}
                                <h3>{store.store_name}</h3>
                                {store.store_city && (
                                    <p className="muted" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <MapPin size={13} /> {store.store_city}
                                    </p>
                                )}
                                <p className="muted">
                                    {store.products.length === 1 ? "1 producto" : `${store.products.length} productos`}
                                </p>
                            </Link>
                        );
                    })}
                </div>
            )}
            {hasMore && (
                <div className="load-more">
                    <button className="btn" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? "Cargando..." : "Cargar más"}
                    </button>
                </div>
            )}
        </div>
    );
}
