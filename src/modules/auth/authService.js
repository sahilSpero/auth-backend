const bcrypt = require("bcryptjs");
const userRepo = require("../user/userRepository");
const authRepo = require("./authRepository");
const jwtUtils = require("../../utils/jwt");
const { sendError } = require("../../utils/response");

// Helper: parse "7d", "15m" strings into a real JS Date for DB storage
const parseExpiry = (expiry) => {
  const units = { m: 60, h: 3600, d: 86400 };
  const match = expiry.match(/^(\d+)([mhd])$/);
  if (!match) throw new Error("Invalid expiry format");
  return new Date(Date.now() + parseInt(match[1]) * units[match[2]] * 1000);
};

// ─── REGISTER ────────────────────────────────────────────────────────────────

const register = async ({ name, email, password }) => {
  // 1. Check email not already taken
  const existing = await userRepo.findByEmail(email);
  if (existing) {
    const error = new Error("Email already in use");
    error.statusCode = 409;
    throw error;
  }

  // 2. Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // 3. Create user with hashed password
  const user = await userRepo.create({ name, email, password: hashedPassword });

  // 4. Return user — NO tokens on register, force them to log in
  return user;
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────

const login = async ({ email, password }) => {
  // 1. Find user WITH password (select: false means we need explicit +password)
  const user = await userRepo.findByEmailWithPassword(email);

  // 2. Generic error 
  if (!user) {
      const error = new Error("Invalid email or password");
      error.statusCode = 401;
      throw error;
  }

  // 3. Compare submitted password with stored hash
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    const error = new Error("Invalid email or password"); // same message — intentional
    error.statusCode = 401;
    throw error;
  }

  // 4. Generate tokens
  const accessToken = jwtUtils.generateAccessToken({
    userId: user._id,
    role: user.role,
  });

  const refreshToken = jwtUtils.generateRefreshToken({
    userId: user._id,
  });

  // 5. Save refresh token in DB
  const expiresAt = parseExpiry(process.env.REFRESH_TOKEN_EXPIRY || "7d");
  await authRepo.saveRefreshToken(user._id, refreshToken, expiresAt);

  // 6. Return both tokens — controller decides where each one goes
  //    (accessToken → response body, refreshToken → httpOnly cookie)
  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
};

// ─── REFRESH ──────────────────────────────────────────────────────────────────

const refresh = async (incomingRefreshToken) => {
  if (!incomingRefreshToken) {
    const error = new Error("Refresh token missing");
    error.statusCode = 401;
    throw error;
  }

  // 1. Verify the token is cryptographically valid (not tampered, not expired)
  let decoded;
  try {
    decoded = jwtUtils.verifyRefreshToken(incomingRefreshToken);
  } catch {
      sendError(res, "Invalid or expired refresh token", 401);
  }

  // 2. Check it actually exists in DB (wasn't logged out)
  const storedToken = await authRepo.findRefreshToken(incomingRefreshToken);
  if (!storedToken) {
    const error = new Error("Refresh token not found — please log in again");
    error.statusCode = 401;
    throw error;
  }

  // 3. ROTATION — delete the old token, issue a brand new one
  //    If someone steals a refresh token and uses it after rotation,
  //    the stolen token won't be in DB anymore — it's dead.
  await authRepo.deleteRefreshToken(incomingRefreshToken);

  // 4. Issue new tokens
  const newAccessToken = jwtUtils.generateAccessToken({
    userId: decoded.userId,
    role: decoded.role,
  });

  const newRefreshToken = jwtUtils.generateRefreshToken({
    userId: decoded.userId,
  });

  const expiresAt = parseExpiry(process.env.REFRESH_TOKEN_EXPIRY || "7d");
  await authRepo.saveRefreshToken(decoded.userId, newRefreshToken, expiresAt);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

const logout = async (refreshToken) => {
  if (!refreshToken) return; // already logged out — silent success

  // Delete this specific token — other sessions stay alive
  await authRepo.deleteRefreshToken(refreshToken);
};

const logoutAll = async (userId) => {
  // Nuclear option — kills all sessions for this user (all devices)
  await authRepo.deleteAllUserTokens(userId);
};

module.exports = { register, login, refresh, logout, logoutAll };