const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está definida (revisa tu .env)");
}

// Un Postgres local (tu máquina) no usa SSL; casi cualquier Postgres hospedado
// (Supabase, Railway, etc.) sí lo exige, y normalmente con un certificado que
// Node no reconoce por defecto — de ahí el rejectUnauthorized:false. Sin esto,
// la conexión falla en silencio (el error real llega casi vacío) y cada query
// termina como un genérico "Error interno del servidor".
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
});

// Sin esto, un error en un cliente inactivo del pool (ej. se cae la conexión)
// es un evento 'error' sin escucha -> Node lo trata como excepción no
// capturada y TUMBA todo el proceso. Loggeamos el error completo (no solo
// .message, que en fallas de red de bajo nivel como AggregateError suele
// venir vacío) para poder diagnosticar sin adivinar.
pool.on("error", (err) => {
    console.error("pool de Postgres, error en cliente inactivo:", err);
});

module.exports = pool;
