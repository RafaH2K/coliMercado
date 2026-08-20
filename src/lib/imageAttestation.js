const pool = require("../config/db");

// Registro auditable de que quien subió una imagen confirmó tener los
// derechos (o autorización) para usarla -- handleUpload() en config/upload.js
// exige ese checkbox antes de aceptar el archivo; esto guarda la evidencia.
async function recordAttestation({ userId, url, kind }) {
    await pool.query(`INSERT INTO image_upload_attestations (user_id, url, kind) VALUES ($1, $2, $3)`, [
        userId,
        url,
        kind,
    ]);
}

module.exports = { recordAttestation };
