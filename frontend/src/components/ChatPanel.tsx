import { useEffect, useRef, useState } from "react";
import { PaperPlaneTilt, X } from "@phosphor-icons/react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Message } from "../types";

const POLL_MS = 4000;

// endpoint: "/appointments/:id/messages" o "/orders/:id/messages" — mismo
// shape en el backend, mismo componente para ambos.
export default function ChatPanel({ endpoint, title, onClose }: { endpoint: string; title: string; onClose: () => void }) {
    const { user } = useAuth();
    const [messages, setMessages] = useState<Message[] | null>(null);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    function load() {
        api
            .get<Message[]>(endpoint)
            .then(setMessages)
            .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el chat"));
    }

    useEffect(() => {
        load();
        const interval = setInterval(load, POLL_MS);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    async function send() {
        const body = draft.trim();
        if (!body) return;
        setSending(true);
        setError(null);
        try {
            await api.post(endpoint, { body });
            setDraft("");
            load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "No se pudo enviar el mensaje");
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="ticket-overlay" onClick={onClose}>
            <div className="chat-panel" onClick={(e) => e.stopPropagation()}>
                <div className="chat-header">
                    <strong>{title}</strong>
                    <button className="btn btn-ghost btn-sm" onClick={onClose}>
                        <X size={16} />
                    </button>
                </div>

                <div className="chat-messages">
                    {!messages ? (
                        <p className="muted">Cargando...</p>
                    ) : messages.length === 0 ? (
                        <p className="muted">Todavía no hay mensajes.</p>
                    ) : (
                        messages.map((m) => (
                            <div
                                key={m.id}
                                className={`chat-bubble ${m.sender_id === user?.id ? "chat-bubble-mine" : "chat-bubble-theirs"}`}
                            >
                                <p>{m.body}</p>
                                <span className="chat-bubble-time">
                                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                            </div>
                        ))
                    )}
                    <div ref={bottomRef} />
                </div>

                {error && <p className="error">{error}</p>}

                <div className="chat-input-row">
                    <input
                        type="text"
                        value={draft}
                        placeholder="Escribe un mensaje..."
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && send()}
                    />
                    <button className="btn btn-primary btn-sm" onClick={send} disabled={sending || !draft.trim()}>
                        <PaperPlaneTilt size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
