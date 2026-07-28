const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const requireServiceOwner = require("../middlewares/serviceOwner");
const services = require("../controllers/services.controller");
const images = require("../controllers/productImages.controller");
const { handleUpload } = require("../config/upload");

const router = Router();

router.get("/", services.search);
router.get("/:id", services.getById);
router.patch("/:id", requireAuth, requireServiceOwner, services.update);
router.get("/:id/availability", services.availability);

router.post("/:id/images", requireAuth, requireServiceOwner, handleUpload("image"), images.add);
router.delete("/:id/images/:imageId", requireAuth, requireServiceOwner, images.remove);

module.exports = router;
