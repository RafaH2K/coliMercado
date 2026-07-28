const { Router } = require("express");
const categories = require("../controllers/categories.controller");

const router = Router();

router.get("/", categories.list);

module.exports = router;
