const test = require("node:test");
const assert = require("node:assert/strict");
const { zonedTimeToUtc, addDays, isValidTimeZone } = require("../src/lib/timezone");

test("zonedTimeToUtc: zona sin DST (Ciudad de México, UTC-6 fijo)", () => {
    const utc = zonedTimeToUtc("2026-08-03", "09:00", "America/Mexico_City");
    assert.equal(utc.toISOString(), "2026-08-03T15:00:00.000Z");
});

test("zonedTimeToUtc: zona con DST activo en verano (Tijuana, UTC-7)", () => {
    const utc = zonedTimeToUtc("2026-08-03", "09:00", "America/Tijuana");
    assert.equal(utc.toISOString(), "2026-08-03T16:00:00.000Z");
});

test("zonedTimeToUtc: misma zona con DST inactivo en invierno (Tijuana, UTC-8)", () => {
    const utc = zonedTimeToUtc("2026-01-15", "09:00", "America/Tijuana");
    assert.equal(utc.toISOString(), "2026-01-15T17:00:00.000Z");
});

test("zonedTimeToUtc: acepta segundos opcionales", () => {
    const utc = zonedTimeToUtc("2026-08-03", "09:00:30", "America/Mexico_City");
    assert.equal(utc.toISOString(), "2026-08-03T15:00:30.000Z");
});

test("addDays: suma días cruzando fin de mes", () => {
    assert.equal(addDays("2026-01-31", 1), "2026-02-01");
    assert.equal(addDays("2026-08-03", 0), "2026-08-03");
});

test("isValidTimeZone: distingue zonas IANA válidas de inválidas", () => {
    assert.equal(isValidTimeZone("America/Mexico_City"), true);
    assert.equal(isValidTimeZone("Not/AZone"), false);
});
