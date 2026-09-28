const jwt = require("jsonwebtoken");
const {
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
} = require("../config/env");

// All token logic lives here — not scattered across auth.service.js
// If you ever switch from JWT to something else, you change one file.

const generateAccessToken = (payload) => {
  // payload = { userId, role }
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY, // 15m default
  });
};

const generateRefreshToken = (payload) => {
  // payload = { userId } — role NOT included, refresh tokens do less
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY, // 7d default
  });
};

const verifyAccessToken = (token) => {
  // throws if expired or invalid — caller handles the error
  return jwt.verify(token, ACCESS_TOKEN_SECRET);
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, REFRESH_TOKEN_SECRET);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};