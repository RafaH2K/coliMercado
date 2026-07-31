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
const favoritesRoutes = require("./routes/favorites.routes");
const cartRoutes = require("./routes/cart.routes");
const ordersRoutes = require("./routes/orders.routes");
const adminRoutes = require("./routes/admin.routes");
const { handleStripeWebhook } = require("./controllers/orders.controller");
const { UPLOAD_DIR } = require("./config/upload");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
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
app.use("/api/favorites", favoritesRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/admin", adminRoutes);

app.get("/", (req, res) => {
    res.send("server responde hola");
});

module.exports = app;
