import { useEffect, useState } from "react";
import { ApiError } from "./api";

// Pide páginas de 24 y las va acumulando ("Cargar más"), en vez de traer todo
// de una vez. `fetchPage` recibe el número de página (1-indexado) y debe
// devolver esa página; cuando devuelve menos de 24 items se asume que es la
// última página.
const PAGE_SIZE = 24;

export function usePaginatedList<T>(fetchPage: (page: number) => Promise<T[]>, deps: unknown[]) {
    const [items, setItems] = useState<T[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);

    useEffect(() => {
        setItems(null);
        setError(null);
        setPage(1);
        fetchPage(1)
            .then((rows) => {
                setItems(rows);
                setHasMore(rows.length === PAGE_SIZE);
            })
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    async function loadMore() {
        setLoadingMore(true);
        try {
            const nextPage = page + 1;
            const rows = await fetchPage(nextPage);
            setItems((prev) => [...(prev ?? []), ...rows]);
            setPage(nextPage);
            setHasMore(rows.length === PAGE_SIZE);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo cargar más resultados");
        } finally {
            setLoadingMore(false);
        }
    }

    return { items, error, hasMore, loadingMore, loadMore };
}
