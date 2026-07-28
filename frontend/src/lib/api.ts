const BASE_URL = import.meta.env.VITE_API_URL as string;

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
};
