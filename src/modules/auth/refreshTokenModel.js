const mongoose = require("mongoose");

// Why store refresh tokens in DB?
// JWTs are stateless — you can't "cancel" one once issued.
// Storing them gives us real logout and rotation:
//   - Logout → delete from DB → token is dead even if not expired
//   - Rotation → delete old, insert new on every /refresh call

const refreshTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

// Auto-delete expired tokens from DB
// MongoDB TTL index — runs a background job that cleans up expired docs
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);

module.exports = RefreshToken;