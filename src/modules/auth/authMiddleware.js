const jwtUtils = require("../../utils/jwt");

// ─── PROTECT ──────────────────────────────────────────────────────────────────
// Verifies the access token. Attaches req.user if valid.
// Use on any route that requires a logged-in user.

const protect = (req, res, next) => {
  // Token comes in: Authorization: Bearer <token>
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const error = new Error("No token provided");
    error.statusCode = 401;
    return next(error); // ← goes to our error middleware, not a manual res.json()
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwtUtils.verifyAccessToken(token);
    req.user = decoded; // { userId, role, iat, exp }
    next();
  } catch (err) {
    // jwt.verify throws "TokenExpiredError" or "JsonWebTokenError"
    const error = new Error(
      err.name === "TokenExpiredError" ? "Token expired" : "Invalid token"
    );
    error.statusCode = 401;
    next(error);
  }
};

// ─── RESTRICT ─────────────────────────────────────────────────────────────────
// Role-based access. Always runs AFTER protect (needs req.user).
// Usage: router.delete("/:id", protect, restrict("admin"), controller)

const restrict = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      const error = new Error(
        `Role '${req.user.role}' is not allowed to perform this action`
      );
      error.statusCode = 403; // 403 Forbidden (authenticated but not authorized)
      return next(error);
    }
    next();
  };
};

module.exports = { protect, restrict };