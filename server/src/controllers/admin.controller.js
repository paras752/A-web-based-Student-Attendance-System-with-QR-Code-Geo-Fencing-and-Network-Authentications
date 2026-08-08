const asyncHandler = require('../utils/asyncHandler');
const adminService = require('../services/admin.service');

const listUsers = asyncHandler(async (req, res) => {
  const { role } = req.query;
  const users = await adminService.listUsers({ role });
  res.json({ users });
});

const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, profile } = req.body;
  const user = await adminService.createUser({ name, email, password, role, profile });
  res.status(201).json({ user });
});

const importStudents = asyncHandler(async (req, res) => {
  const result = await adminService.importStudents(req.body.students);
  res.status(200).json(result);
});

const changeUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  await adminService.changeUserRole(Number(req.params.id), role, req.user.id);
  res.status(204).send();
});

// The list view carries only what the table shows. An edit form needs the full record -
// loading it first is what stops a save from blanking the fields the list never displayed.
const getUser = asyncHandler(async (req, res) => {
  const user = await adminService.getUser(Number(req.params.id));
  res.json({ user });
});

const updateUserProfile = asyncHandler(async (req, res) => {
  const { name, email, profile } = req.body;
  const user = await adminService.updateUserProfile(Number(req.params.id), { name, email, profile });
  res.json({ user });
});

const setStudentNumber = asyncHandler(async (req, res) => {
  const result = await adminService.setStudentNumber(
    Number(req.params.id),
    req.body.studentNumber
  );
  res.json(result);
});

const resetUserPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  await adminService.resetUserPassword(Number(req.params.id), newPassword);
  res.status(204).send();
});

const deleteUser = asyncHandler(async (req, res) => {
  await adminService.deleteUser(Number(req.params.id));
  res.status(204).send();
});

const analytics = asyncHandler(async (req, res) => {
  const data = await adminService.getAnalytics();
  res.json(data);
});

module.exports = {
  listUsers,
  getUser,
  createUser,
  importStudents,
  changeUserRole,
  updateUserProfile,
  setStudentNumber,
  resetUserPassword,
  deleteUser,
  analytics,
};
