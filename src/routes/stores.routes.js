const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const requireStoreOwner = require("../middlewares/storeOwner");
const enforceProductLimit = require("../middlewares/planLimit");
const stores = require("../controllers/stores.controller");
const businessHours = require("../controllers/businessHours.controller");
const services = require("../controllers/services.controller");
const products = require("../controllers/products.controller");
const appointments = require("../controllers/appointments.controller");
const orders = require("../controllers/orders.controller");
const reviews = require("../controllers/reviews.controller");
const { handleUpload } = require("../config/upload");

const router = Router();

router.post("/", requireAuth, stores.create);
router.get("/", stores.list);
router.get("/mine", requireAuth, stores.mine); // antes de "/:storeId" para que no lo capture como id
router.get("/:storeId", stores.getById);
router.patch("/:storeId", requireAuth, requireStoreOwner, stores.update);
router.patch("/:storeId/plan", requireAuth, requireStoreOwner, stores.setPlan);
router.post("/:storeId/logo", requireAuth, requireStoreOwner, handleUpload("logo"), stores.uploadLogo);
router.get("/:storeId/stats", requireAuth, requireStoreOwner, stores.getStats);

router.get("/:storeId/business-hours", businessHours.getForStore);
router.put("/:storeId/business-hours", requireAuth, requireStoreOwner, businessHours.replaceForStore);

router.get("/:storeId/services", services.listForStore);
router.post("/:storeId/services", requireAuth, requireStoreOwner, enforceProductLimit, services.create);

router.get("/:storeId/products", products.listForStore);
router.post("/:storeId/products", requireAuth, requireStoreOwner, enforceProductLimit, products.create);

router.get("/:storeId/appointments", requireAuth, requireStoreOwner, appointments.listForStore);
router.get("/:storeId/orders", requireAuth, requireStoreOwner, orders.listForStore);

router.get("/:storeId/reviews", reviews.listForStore);
router.post("/:storeId/reviews", requireAuth, reviews.upsert);

module.exports = router;
