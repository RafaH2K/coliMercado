const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está definida (revisa tu .env)");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = pool;
