// CORS_ORIGIN es una lista (puede traer localhost + producción a la vez, en
// cualquier orden — ver app.js) y un link de verdad (checkout de Stripe,
// reset de contraseña) necesita UNA sola URL: la de producción, siempre,
// sin importar en qué orden esté CORS_ORIGIN. FRONTEND_URL es justo eso.
// Si no está seteada (dev local con un solo origen) se cae al primer valor
// de CORS_ORIGIN, que en ese caso sí es inequívoco.
function frontendUrl() {
    const explicit = (process.env.FRONTEND_URL || "").trim().replace(/\/$/, "");
    if (explicit) return explicit;
    return (process.env.CORS_ORIGIN || "")
        .split(",")[0]
        .trim()
        .replace(/\/$/, "");
}

module.exports = { frontendUrl };
