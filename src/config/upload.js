const fs = require("fs");
const path = require("path");
const multer = require("multer");

// uploads/ sigue sirviendo las imágenes subidas antes de migrar a Supabase
// Storage (ver src/lib/storage.js) — no se toca hasta que se decida migrarlas.
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Nunca confiar en el nombre/extensión que manda el cliente (path traversal,
// disfrazar un ejecutable de ".jpg", etc.) — el nombre final sale de una
// lista fija según el mimetype real.
const EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (!EXT_BY_MIME[file.mimetype]) {
            return cb(new Error("Formato de imagen no soportado (usa JPEG, PNG, WEBP o GIF)"));
        }
        cb(null, true);
    },
});

// multer reporta errores (tamaño, mimetype) vía callback, no como excepción
// normal de Express — sin esto, un archivo inválido tumba la request sin
// respuesta JSON clara.
function handleUpload(fieldName) {
    const middleware = upload.single(fieldName);
    return (req, res, next) => {
        middleware(req, res, (err) => {
            if (err) return res.status(400).json({ error: err.message });
            if (!req.file) return res.status(400).json({ error: `Falta el archivo '${fieldName}'` });
            next();
        });
    };
}

module.exports = { handleUpload, UPLOAD_DIR, EXT_BY_MIME };
