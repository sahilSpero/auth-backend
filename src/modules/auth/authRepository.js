const RefreshToken = require("./refreshTokenModel");

// Save a new refresh token to DB
const saveRefreshToken = (userId, token, expiresAt) => {
  return RefreshToken.create({ user: userId, token, expiresAt });
};

// Find token in DB — used to verify it's still valid (not logged out)
const findRefreshToken = (token) => {
  return RefreshToken.findOne({ token });
};

// Delete one specific token — used on logout and rotation
const deleteRefreshToken = (token) => {
  return RefreshToken.deleteOne({ token });
};

// Delete ALL tokens for a user — used for "logout from all devices"
const deleteAllUserTokens = (userId) => {
  return RefreshToken.deleteMany({ user: userId });
};

module.exports = {
  saveRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
  deleteAllUserTokens,
};