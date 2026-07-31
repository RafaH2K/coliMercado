const { Router } = require("express");
const plans = require("../controllers/plans.controller");

const router = Router();

router.get("/", plans.list);

module.exports = router;
