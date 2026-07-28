import { createContext, useContext, useState, type ReactNode } from "react";
import type { User } from "../types";
import { api } from "./api";

interface AuthContextValue {
    user: User | null;
    login: (email: string, password: string) => Promise<void>;
    register: (data: { name: string; email: string; phone?: string; password: string }) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredUser(): User | null {
    const raw = localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as User) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(loadStoredUser);

    function persist(user: User, token: string) {
        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(user));
        setUser(user);
    }

    async function login(email: string, password: string) {
        const { user, token } = await api.post<{ user: User; token: string }>("/auth/login", { email, password });
        persist(user, token);
    }

    async function register(data: { name: string; email: string; phone?: string; password: string }) {
        const { user, token } = await api.post<{ user: User; token: string }>("/auth/register", data);
        persist(user, token);
    }

    function logout() {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUser(null);
    }

    return <AuthContext.Provider value={{ user, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
    return ctx;
}
