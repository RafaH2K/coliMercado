const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const requireAdmin = require("../middlewares/admin");
const admin = require("../controllers/admin.controller");

const router = Router();

router.use(requireAuth, requireAdmin);
router.get("/stores/pending", admin.listPendingStores);
router.get("/stores/approved", admin.listApprovedStores);
router.post("/stores/:id/approve", admin.approveStore);
router.delete("/stores/:id", admin.rejectStore);
router.patch("/stores/:id/active", admin.setActive);

module.exports = router;
