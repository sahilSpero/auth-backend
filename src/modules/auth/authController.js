const authService = require("./authService");
const { sendSuccess } = require("../../utils/response");

// Cookie config — centralized so it's consistent across login/refresh/logout
const COOKIE_OPTIONS = {
  httpOnly: true,   // JS cannot read this cookie — blocks XSS token theft
  secure: process.env.NODE_ENV === "production", // HTTPS only in prod
  sameSite: "strict", // blocks CSRF — cookie not sent on cross-site requests
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
};

// ─── REGISTER ─────────────────────────────────────────────────────────────────

const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    console.log(name, email, password, "=== register ===");

    // Basic presence check — full validation comes in Phase 2.5 with express-validator
    if (!name || !email || !password) {
      const error = new Error("Name, email and password are required");
      error.statusCode = 400;
      return next(error);
    }

    const user = await authService.register({ name, email, password });
    sendSuccess(res, user, "Registered successfully", 201);
  } catch (error) {
    next(error);
  }
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      const error = new Error("Email and password are required");
      error.statusCode = 400;
      return next(error);
    }

    const { accessToken, refreshToken, user } = await authService.login({
      email,
      password,
    });

    // refreshToken → httpOnly cookie (invisible to JS, safe from XSS)
    res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

    // accessToken → response body (client stores in memory, not localStorage)
    sendSuccess(res, { accessToken, user }, "Logged in successfully");
  } catch (error) {
    next(error);
  }
};

// ─── REFRESH ──────────────────────────────────────────────────────────────────

const refresh = async (req, res, next) => {
  try {
    // Cookie is sent automatically by the browser — no manual work on client
    const incomingRefreshToken = req.cookies?.refreshToken;

    const { accessToken, refreshToken } =
      await authService.refresh(incomingRefreshToken);

    // Rotate the cookie too
    res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

    sendSuccess(res, { accessToken }, "Token refreshed successfully");
  } catch (error) {
    next(error);
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

const logout = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    await authService.logout(refreshToken);

    // Clear the cookie from the browser
    res.clearCookie("refreshToken", COOKIE_OPTIONS);

    sendSuccess(res, null, "Logged out successfully");
  } catch (error) {
    next(error);
  }
};

// ─── LOGOUT ALL DEVICES ───────────────────────────────────────────────────────

const logoutAll = async (req, res, next) => {
  try {
    // req.user is set by protect middleware — userId comes from the access token
    await authService.logoutAll(req.user.userId);

    res.clearCookie("refreshToken", COOKIE_OPTIONS);
    sendSuccess(res, null, "Logged out from all devices");
  } catch (error) {
    next(error);
  }
};

module.exports = { register, login, refresh, logout, logoutAll };