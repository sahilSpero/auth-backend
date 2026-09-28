const express = require("express");
const router = express.Router();
const userController = require("./userController");

// auth middleware will be imported and used in Phase 2
// For now these are open — we'll lock them down with:
// protect       → must be logged in
// restrict()    → must have specific role
//

//get all users
router.get("/", userController.getAllUsers);
//get user by id
router.get("/:id", userController.getUserById);
//create user
router.post("/", userController.createUser);
//update user
router.put("/:id", userController.updateUser);
//delete user
router.delete("/:id", userController.deleteUser);

// Admin-only action — will add restrict("admin") in Phase 2
router.post("/:id/promote", userController.promoteToAdmin);

module.exports = router;