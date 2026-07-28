const { Router } = require("express");
const requireAuth = require("../middlewares/auth");
const favorites = require("../controllers/favorites.controller");

const router = Router();

router.use(requireAuth);
router.get("/", favorites.listMine);
router.post("/", favorites.add);
router.delete("/:storeId", favorites.remove);

module.exports = router;
