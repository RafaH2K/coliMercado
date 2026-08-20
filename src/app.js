// Debe requerirse antes que el resto (recomendación de Sentry) -- sin esto
// instrumenta menos de lo que podría, aunque acá lo que de verdad importa es
// el wrap de console.error que hace este módulo al cargarse.
const { Sentry, enabled: sentryEnabled } = require("./config/sentry");
const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth.routes");
const storesRoutes = require("./routes/stores.routes");
const servicesRoutes = require("./routes/services.routes");
const productsRoutes = require("./routes/products.routes");
const appointmentsRoutes = require("./routes/appointments.routes");
const categoriesRoutes = require("./routes/categories.routes");
const plansRoutes = require("./routes/plans.routes");
const favoritesRoutes = require("./routes/favorites.routes");
const cartRoutes = require("./routes/cart.routes");
const ordersRoutes = require("./routes/orders.routes");
const adminRoutes = require("./routes/admin.routes");
const mercadopagoRoutes = require("./routes/mercadopago.routes");
const { handleStripeWebhook } = require("./controllers/orders.controller");
const { UPLOAD_DIR } = require("./config/upload");

const app = express();

// En producción corre detrás de un solo proxy (Railway/Render/etc.), que es
// quien pone X-Forwarded-For; sin esto, express-rate-limit rechaza confiar en
// ese header (podría venir falsificado por el cliente) y tumba cualquier ruta
// con rate limit. "1" = confiar solo en ese primer salto, no en toda la cadena.
app.set("trust proxy", 1);

app.use(helmet());
// CORS_ORIGIN acepta uno o varios orígenes separados por coma (ej. tu app en
// local + la desplegada en Vercel), para no tener que cambiar la variable de
// entorno cada vez que se prueba contra uno u otro.
// El header Origin del navegador nunca trae barra final, así que se le quita
// a cada valor configurado — si no, "https://x.com/" en la variable de
// entorno nunca hace match contra el "https://x.com" real que manda el navegador.
const allowedOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
app.use(
    cors({
        origin: (origin, callback) => {
            // Sin header Origin (curl, llamadas servidor-a-servidor) o coincide
            // con la lista permitida.
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            callback(new Error("Origen no permitido por CORS"));
        },
        credentials: true,
    })
);
app.use(morgan("dev"));

// Stripe firma el cuerpo crudo de la petición para verificar que el webhook
// viene realmente de Stripe, así que esta ruta debe montarse ANTES de
// express.json() (que reemplazaría el body crudo por el objeto parseado).
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json());

// helmet pone Cross-Origin-Resource-Policy: same-origin por default, lo que
// bloquea que el frontend (otro puerto = otro origen) cargue estas imágenes
// en <img>. Se relaja solo aquí, no en el resto de la API.
app.use(
    "/uploads",
    express.static(UPLOAD_DIR, {
        setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
    })
);

app.use("/api/auth", authRoutes);
app.use("/api/stores", storesRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/appointments", appointmentsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/plans", plansRoutes);
app.use("/api/favorites", favoritesRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/mercadopago", mercadopagoRoutes);

app.get("/", (req, res) => {
    res.send("server responde hola");
});

// Captura lo que sí llegue a tronar sin ser atrapado localmente (bugs fuera
// de un try/catch) -- debe ir después de las rutas y antes del manejador de
// errores propio de abajo, que sigue siendo el que arma la respuesta final.
if (sentryEnabled) {
    Sentry.setupExpressErrorHandler(app);
}

// Sin esto, un origen rechazado por cors() cae al manejador de errores por
// default de Express: un 500 en HTML, indistinguible de una falla real del
// servidor (nos confundió varias veces mientras se depuraba el deploy). Debe
// ir al final, con los 4 parámetros (así Express lo reconoce como manejador
// de errores, no como middleware normal).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.message === "Origen no permitido por CORS") {
        return res.status(403).json({ error: err.message });
    }
    console.error("Error no manejado:", err);
    res.status(500).json({ error: "Error interno del servidor" });
});

module.exports = app;
