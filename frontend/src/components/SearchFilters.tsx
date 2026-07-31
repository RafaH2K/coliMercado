import { MagnifyingGlass } from "@phosphor-icons/react";
import type { Category } from "../types";

export function SearchFilters({
    q,
    setQ,
    categoryId,
    setCategoryId,
    city,
    setCity,
    categories,
    placeholder,
}: {
    q: string;
    setQ: (v: string) => void;
    categoryId: string;
    setCategoryId: (v: string) => void;
    city: string;
    setCity: (v: string) => void;
    categories: Category[];
    placeholder: string;
}) {
    return (
        <div className="inline-form">
            <div className="search-input">
                <MagnifyingGlass size={16} />
                <input placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                    </option>
                ))}
            </select>
            <input placeholder="Ciudad" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
    );
}
