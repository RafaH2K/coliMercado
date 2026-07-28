const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const appointments = require("../controllers/appointments.controller");

const router = Router();

router.post("/", requireAuth, appointments.create);
router.get("/me", requireAuth, appointments.listMine);
router.patch("/:id/status", requireAuth, appointments.updateStatus);

module.exports = router;
