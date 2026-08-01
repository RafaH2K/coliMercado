const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { EXT_BY_MIME } = require("../config/upload");

const bucket = process.env.SUPABASE_BUCKET || "uploads";

// Client perezoso: si SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY faltan, el
// servidor debe poder arrancar igual (solo falla al intentar subir/borrar
// una imagen), en vez de tumbar todo el require() de las rutas.
let supabase;
function client() {
    if (!supabase) {
        // Service role key: bypasa RLS de Storage, solo debe vivir en el backend.
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    }
    return supabase;
}

// Sube un archivo de multer (memoryStorage: req.file con .buffer y .mimetype)
// y devuelve la URL pública del objeto en el bucket.
async function uploadImage(file) {
    const name = crypto.randomUUID() + EXT_BY_MIME[file.mimetype];
    const { error } = await client().storage.from(bucket).upload(name, file.buffer, { contentType: file.mimetype });
    if (error) throw error;
    return client().storage.from(bucket).getPublicUrl(name).data.publicUrl;
}

// No-op si la URL no es de este bucket (ej. imágenes viejas servidas desde /uploads).
function deleteImage(url) {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const i = url.indexOf(marker);
    if (i === -1) return;
    const name = url.slice(i + marker.length);
    client()
        .storage.from(bucket)
        .remove([name])
        .catch(() => {});
}

module.exports = { uploadImage, deleteImage };
