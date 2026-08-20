const Sentry = require("@sentry/node");

// Sin SENTRY_DSN el proyecto sigue funcionando exactamente igual, solo sin
// reportar nada -- mismo patrón que storage.js/whatsappNotifications.js:
// una integración opcional que no debe tumbar el arranque si falta su
// configuración.
const enabled = !!process.env.SENTRY_DSN;

// El patrón dominante en este código es "atrapar el error localmente, hacer
// console.error, responder algo razonable" (ver casi cualquier controller) --
// casi ningún error real llega al error handler de Express de app.js. Para
// que Sentry vea los reembolsos/webhooks/renovaciones de token que fallan
// hay que engancharse en console.error, no solo en el error handler.
// Función pura para poder probarla sin mutar el console.error global.
function wrapConsoleError(sentry, originalConsoleError) {
    return (...args) => {
        originalConsoleError(...args);
        const err = args.find((a) => a instanceof Error);
        if (err) {
            sentry.captureException(err);
        } else {
            sentry.captureMessage(
                args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
                "error"
            );
        }
    };
}

if (enabled) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || "development",
        tracesSampleRate: 0, // solo errores, no hace falta tracing de performance
    });
    console.error = wrapConsoleError(Sentry, console.error);
}

module.exports = { Sentry, enabled, wrapConsoleError };
