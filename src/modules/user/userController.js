const userService = require("./userService");
const { sendSuccess, sendError } = require("../../utils/response");

const getAllUsers = async (req, res, next) => {
  try {
    const users = await userService.getAllUsers();
    sendSuccess(res, users, "Users fetched successfully");
  } catch (error) {
    sendError(res, error.message);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    sendSuccess(res, user, "User fetched successfully");
  } catch (error) {
    sendError(res, error.message);
  }
};

const createUser = async (req, res, next) => {
  try {
    const user = await userService.createUser(req.body);
    sendSuccess(res, user, "User created successfully", 201);
  } catch (error) {
    sendError(res, error.message);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const user = await userService.updateUser(req.params.id, req.body);
    sendSuccess(res, user, "User updated successfully");
  } catch (error) {
    sendError(res, error.message);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    await userService.deleteUser(req.params.id);
    sendSuccess(res, null, "User deleted successfully");
  } catch (error) {
    sendError(res, error.message);
  }
};

// ← Your exercise from Phase 1 — now built in properly
const promoteToAdmin = async (req, res, next) => {
  try {
    const user = await userService.promoteToAdmin(req.params.id);
    sendSuccess(res, user, "User promoted to admin");
  } catch (error) {
    sendError(res, error.message);
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  promoteToAdmin,
};