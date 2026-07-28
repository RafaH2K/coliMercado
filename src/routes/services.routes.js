const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const requireServiceOwner = require("../middlewares/serviceOwner");
const services = require("../controllers/services.controller");

const router = Router();

router.get("/", services.search);
router.get("/:id", services.getById);
router.patch("/:id", requireAuth, requireServiceOwner, services.update);
router.get("/:id/availability", services.availability);

module.exports = router;
