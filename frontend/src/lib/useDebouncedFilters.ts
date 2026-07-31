import { useEffect, useState } from "react";

// Compartido por las páginas de búsqueda (negocios, mercado, reservaciones):
// junta q/categoría/ciudad en un querystring debounced, para no golpear la
// API en cada tecla.
export function useDebouncedFilters() {
    const [q, setQ] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const [city, setCity] = useState("");
    const [qs, setQs] = useState("");

    useEffect(() => {
        const timeout = setTimeout(() => {
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (categoryId) params.set("category_id", categoryId);
            if (city) params.set("city", city);
            setQs(params.toString());
        }, 300);
        return () => clearTimeout(timeout);
    }, [q, categoryId, city]);

    return { q, setQ, categoryId, setCategoryId, city, setCity, qs };
}
