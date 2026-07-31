const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const requireProductOwner = require("../middlewares/productOwner");
const products = require("../controllers/products.controller");
const images = require("../controllers/productImages.controller");
const { handleUpload } = require("../config/upload");

const router = Router();

router.get("/", products.search);
router.get("/:id", products.getById);
router.patch("/:id", requireAuth, requireProductOwner, products.update);

router.post("/:id/images", requireAuth, requireProductOwner, handleUpload("image"), images.add);
router.delete("/:id/images/:imageId", requireAuth, requireProductOwner, images.remove);

module.exports = router;
