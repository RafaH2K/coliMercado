// Conversión de hora de pared (fecha+hora locales de un negocio) a instante
// UTC real, usando solo Intl (sin dependencias). Necesario porque
// business_hours/special_dates guardan TIME de pared ("09:00") que solo
// tiene sentido interpretado en la zona del negocio, no en UTC.

function isValidTimeZone(tz) {
    try {
        // eslint-disable-next-line no-new
        new Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

function partsInZone(date, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    const parts = {};
    for (const { type, value } of fmt.formatToParts(date)) {
        if (type !== "literal") parts[type] = value;
    }
    if (parts.hour === "24") parts.hour = "0"; // medianoche a veces sale como "24"
    return parts;
}

// dateStr: "YYYY-MM-DD", timeStr: "HH:MM" o "HH:MM:SS", ambos como hora de
// pared en `timeZone`. Converge en <=2 iteraciones incluso cerca de
// transiciones de horario de verano (el mismo enfoque que usan librerías
// como date-fns-tz internamente).
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    const [h, mi, s = 0] = timeStr.split(":").map(Number);
    const wanted = Date.UTC(y, mo - 1, d, h, mi, s);

    let guess = wanted;
    for (let i = 0; i < 2; i++) {
        const parts = partsInZone(new Date(guess), timeZone);
        const got = Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            Number(parts.hour),
            Number(parts.minute),
            Number(parts.second)
        );
        const diff = wanted - got;
        if (diff === 0) break;
        guess += diff;
    }
    return new Date(guess);
}

function addDays(dateStr, days) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

module.exports = { isValidTimeZone, zonedTimeToUtc, addDays };
