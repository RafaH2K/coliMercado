// CORS_ORIGIN puede traer varios orígenes separados por coma (ver app.js),
// pero un link de verdad (checkout de Stripe, reset de contraseña) necesita
// UNA sola URL — se usa el primero de la lista, sin barra final.
function frontendUrl() {
    return (process.env.CORS_ORIGIN || "")
        .split(",")[0]
        .trim()
        .replace(/\/$/, "");
}

module.exports = { frontendUrl };
