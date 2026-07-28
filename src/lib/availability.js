// Lógica pura de disponibilidad de citas: sin acceso a DB, fácil de testear.
// Asume que window.start/end y las citas ya vienen en el mismo huso horario
// (hoy: UTC, no hay columna de timezone por negocio todavía).

function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
}

// windows: [{start: Date, end: Date}]
// Genera slots de "durationMinutes" separados por "durationMinutes + bufferMinutes".
function generateCandidateSlots(windows, durationMinutes, bufferMinutes) {
    const stepMs = (durationMinutes + bufferMinutes) * 60 * 1000;
    const durationMs = durationMinutes * 60 * 1000;
    const slots = [];
    for (const { start, end } of windows) {
        let slotStart = new Date(start);
        while (slotStart.getTime() + durationMs <= end.getTime()) {
            slots.push({ start: new Date(slotStart), end: new Date(slotStart.getTime() + durationMs) });
            slotStart = new Date(slotStart.getTime() + stepMs);
        }
    }
    return slots;
}

// busyRanges: [{start, end}] citas o bloqueos ya existentes.
// capacity: cuántas ocupaciones simultáneas caben en un mismo slot.
function filterAvailable(slots, busyRanges, capacity) {
    return slots.filter(({ start, end }) => {
        const busyCount = busyRanges.filter((b) => overlaps(start, end, b.start, b.end)).length;
        return busyCount < capacity;
    });
}

module.exports = { overlaps, generateCandidateSlots, filterAvailable };
