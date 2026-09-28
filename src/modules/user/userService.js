const userRepo = require("./userRepository");

// NOTE: Password hashing does NOT live here.
// Hashing is an auth concern — it lives in auth.service.js
// This service handles user data management, not authentication.

const getAllUsers = async () => {
  return userRepo.findAll();
};

const getUserById = async (id) => {
  const user = await userRepo.findById(id);
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }
  return user;
};

// createUser here is for admin-created users or seeding
// Self-registration goes through auth.service.js (register)
const createUser = async (userData) => {
  const existing = await userRepo.findByEmail(userData.email);
  if (existing) {
    const error = new Error("Email already in use");
    error.statusCode = 409;
    throw error;
  }
  return userRepo.create(userData);
};

const updateUser = async (id, updateData) => {
  await getUserById(id); // throws 404 if not found
  return userRepo.updateById(id, updateData);
};

const deleteUser = async (id) => {
  await getUserById(id);
  await userRepo.deleteById(id);
};

const promoteToAdmin = async (id) => {
  const user = await getUserById(id); // throws 404 if not found

  if (user.role === "admin") {
    const error = new Error("User is already an admin");
    error.statusCode = 400;
    throw error;
  }

  return userRepo.updateById(id, { role: "admin" });
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  promoteToAdmin,
};