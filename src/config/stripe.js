const Stripe = require("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY no está definida (revisa tu .env)");
}

module.exports = new Stripe(process.env.STRIPE_SECRET_KEY);
