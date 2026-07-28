// Lista corta de países con presencia hispanohablante/relevante para el
// proyecto, no las ~195 del mundo — el selector es para simplificar captura
// del código de país en el teléfono, no un directorio geográfico completo.
export const COUNTRIES = [
    { dial: "52", name: "México" },
    { dial: "1", name: "Estados Unidos / Canadá" },
    { dial: "502", name: "Guatemala" },
    { dial: "503", name: "El Salvador" },
    { dial: "504", name: "Honduras" },
    { dial: "505", name: "Nicaragua" },
    { dial: "506", name: "Costa Rica" },
    { dial: "507", name: "Panamá" },
    { dial: "34", name: "España" },
    { dial: "54", name: "Argentina" },
    { dial: "57", name: "Colombia" },
    { dial: "56", name: "Chile" },
    { dial: "51", name: "Perú" },
    { dial: "58", name: "Venezuela" },
    { dial: "598", name: "Uruguay" },
    { dial: "595", name: "Paraguay" },
    { dial: "591", name: "Bolivia" },
    { dial: "593", name: "Ecuador" },
] as const;

export const DEFAULT_DIAL = "52"; // México

// Los códigos más largos deben probarse primero (ej. "502" antes que "52").
const BY_DIAL_LENGTH_DESC = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

export function splitPhone(fullPhone: string | null | undefined): { dial: string; local: string } {
    const digits = (fullPhone || "").replace(/\D/g, "");
    for (const c of BY_DIAL_LENGTH_DESC) {
        if (digits.startsWith(c.dial)) {
            return { dial: c.dial, local: digits.slice(c.dial.length) };
        }
    }
    return { dial: DEFAULT_DIAL, local: digits };
}

export function joinPhone(dial: string, local: string): string {
    const digits = local.replace(/\D/g, "");
    return digits ? `${dial}${digits}` : "";
}
