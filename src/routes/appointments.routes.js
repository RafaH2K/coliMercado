const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const appointments = require("../controllers/appointments.controller");
const messages = require("../controllers/messages.controller");

const router = Router();

router.post("/", requireAuth, appointments.create);
router.post("/deposit/confirm", requireAuth, appointments.confirmDeposit);
router.get("/me", requireAuth, appointments.listMine);
router.patch("/:id/status", requireAuth, appointments.updateStatus);
router.get("/:id/messages", requireAuth, messages.listForAppointment);
router.post("/:id/messages", requireAuth, messages.createForAppointment);

module.exports = router;
