const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const authController = require("./authController");
// const { protect } = require("../../middlewares/authMiddleware");

// Rate limiter — max 10 attempts per IP per 15 minutes on auth routes
// Prevents brute force on login and register
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    success: false,
    message: "Too many attempts. Please try again after 15 minutes.",
    data: null,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes — rate limited
router.post("/register", authLimiter, authController.register);
router.post("/login", authLimiter, authController.login);
router.post("/refresh", authController.refresh); // no rate limit — cookie auto-sent

// Protected routes — need valid access token
// router.post("/logout", protect, authController.logout);
// router.post("/logout-all", protect, authController.logoutAll);

module.exports = router;