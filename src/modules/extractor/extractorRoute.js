const express = require("express");
const router = express.Router();
const extractorController = require("./extractorController");

// Public for now — will be locked down with protect middleware later
router.post("/", extractorController.extract);

module.exports = router;
