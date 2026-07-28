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
