const User = require("./userModel");

const findAll = () => {
  return User.find(); // password excluded by default (select: false)
};

const findById = (id) => {
  return User.findById(id);
};

const findByEmail = (email) => {
  return User.findOne({ email }); // password excluded — used to check existence
};

// ← NEW: only used by auth service during login
// We need the password hash to compare — must explicitly re-include it
const findByEmailWithPassword = (email) => {
  return User.findOne({ email }).select("+password");
};

const create = (userData) => {
  return User.create(userData);
};

const updateById = (id, updateData) => {
  return User.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });
};

const deleteById = (id) => {
  return User.findByIdAndDelete(id);
};

module.exports = {
  findAll,
  findById,
  findByEmail,
  findByEmailWithPassword, // ← exported for auth service
  create,
  updateById,
  deleteById,
};