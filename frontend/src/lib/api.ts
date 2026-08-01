// Quita una barra final si la pegaron (ej. ".../api/"): sin esto, path que ya
// empieza con "/" produce URLs con doble barra ("...api//stores").
const BASE_URL = (import.meta.env.VITE_API_URL as string)?.replace(/\/$/, "");
if (!BASE_URL) {
    // Sin esto, el error real queda enterrado como "Cannot read properties of
    // undefined (reading 'replace')" en el bundle minificado — imposible de
    // diagnosticar en producción. VITE_API_URL se lee en build time: hay que
    // configurarla en las variables de entorno del hosting (ej. Vercel), no
    // solo en el .env local (ese nunca llega al build de producción).
    throw new Error(
        "VITE_API_URL no está definida. Configúrala en las variables de entorno de tu despliegue (ej. Vercel > Project Settings > Environment Variables) y vuelve a desplegar."
    );
}
// El backend sirve /uploads fuera de /api, así que las URLs de imágenes
// relativas ("/uploads/x.png") necesitan el host sin el sufijo /api.
export const FILES_BASE_URL = BASE_URL.replace(/\/api\/?$/, "");

export class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

function getToken(): string | null {
    return localStorage.getItem("token");
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = getToken();
    const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers,
        },
    });

    const isJson = res.headers.get("content-type")?.includes("application/json");
    const body = isJson ? await res.json() : null;

    if (!res.ok) {
        throw new ApiError(res.status, body?.error || `Error ${res.status}`);
    }
    return body as T;
}

export const api = {
    get: <T>(path: string) => apiFetch<T>(path),
    post: <T>(path: string, data?: unknown) =>
        apiFetch<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
    patch: <T>(path: string, data?: unknown) =>
        apiFetch<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
    put: <T>(path: string, data?: unknown) =>
        apiFetch<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
    delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
    // FormData: no fijar Content-Type manualmente, el navegador pone el
    // boundary del multipart automáticamente.
    upload: async <T>(path: string, formData: FormData) => {
        const token = getToken();
        const res = await fetch(`${BASE_URL}${path}`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            body: formData,
        });
        const isJson = res.headers.get("content-type")?.includes("application/json");
        const body = isJson ? await res.json() : null;
        if (!res.ok) throw new ApiError(res.status, body?.error || `Error ${res.status}`);
        return body as T;
    },
};

export function imageUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    return url.startsWith("http") ? url : `${FILES_BASE_URL}${url}`;
}
