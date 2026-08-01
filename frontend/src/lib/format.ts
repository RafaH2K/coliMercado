// Formatea instantes UTC en la zona del NEGOCIO (no la del visitante) para
// que "9:00" siempre signifique 9:00 en la ciudad del negocio, sin importar
// desde dónde esté navegando el cliente.

export function formatTime(iso: string, timeZone?: string) {
    return new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
    });
}

export function formatDateTime(iso: string, timeZone?: string) {
    return new Date(iso).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
    });
}

// Folio corto para que el cliente y el negocio puedan verificar entre ellos
// que hablan del mismo pedido (ej. por WhatsApp), sin tener que leerse el
// UUID completo. Mismos primeros 8 caracteres en ambos lados: el id ya es
// único, esto solo lo hace legible.
export function orderFolio(id: string) {
    return id.slice(0, 8).toUpperCase();
}
