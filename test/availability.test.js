const test = require("node:test");
const assert = require("node:assert/strict");
const { overlaps, generateCandidateSlots, filterAvailable } = require("../src/lib/availability");

function d(hhmm) {
    return new Date(`2026-08-01T${hhmm}:00.000Z`);
}

test("overlaps: rangos que se cruzan vs. contiguos vs. separados", () => {
    assert.equal(overlaps(d("09:00"), d("10:00"), d("09:30"), d("09:45")), true);
    assert.equal(overlaps(d("09:00"), d("10:00"), d("10:00"), d("11:00")), false);
    assert.equal(overlaps(d("09:00"), d("10:00"), d("08:00"), d("08:59")), false);
});

test("generateCandidateSlots respeta duración y buffer entre citas", () => {
    const windows = [{ start: d("09:00"), end: d("10:10") }];
    const slots = generateCandidateSlots(windows, 30, 10); // paso de 40min

    assert.equal(slots.length, 2);
    assert.deepEqual([slots[0].start, slots[0].end], [d("09:00"), d("09:30")]);
    assert.deepEqual([slots[1].start, slots[1].end], [d("09:40"), d("10:10")]);
});

test("generateCandidateSlots no genera un slot que no cabe en la ventana", () => {
    const windows = [{ start: d("09:00"), end: d("09:20") }];
    assert.equal(generateCandidateSlots(windows, 30, 0).length, 0);
});

test("filterAvailable descarta slots ocupados cuando capacity=1", () => {
    const slots = generateCandidateSlots([{ start: d("09:00"), end: d("10:10") }], 30, 10);
    const busy = [{ start: d("09:10"), end: d("09:20") }]; // se traslapa con el primer slot
    const available = filterAvailable(slots, busy, 1);
    assert.equal(available.length, 1);
    assert.deepEqual(available[0].start, d("09:40"));
});

test("filterAvailable permite hasta 'capacity' ocupaciones simultáneas", () => {
    const slots = [{ start: d("09:00"), end: d("09:30") }];
    const busy = [
        { start: d("09:00"), end: d("09:30") },
        { start: d("09:10"), end: d("09:20") },
    ];
    assert.equal(filterAvailable(slots, busy, 2).length, 0); // ya hay 2, capacity=2 -> lleno
    assert.equal(filterAvailable(slots, busy, 3).length, 1); // capacity=3 -> aún cabe 1
});
