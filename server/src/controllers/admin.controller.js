const asyncHandler = require('../utils/asyncHandler');
const adminService = require('../services/admin.service');

const listUsers = asyncHandler(async (req, res) => {
  const { role } = req.query;
  const users = await adminService.listUsers({ role });
  res.json({ users });
});

const deleteUser = asyncHandler(async (req, res) => {
  await adminService.deleteUser(Number(req.params.id));
  res.status(204).send();
});

const analytics = asyncHandler(async (req, res) => {
  const data = await adminService.getAnalytics();
  res.json(data);
});

module.exports = { listUsers, deleteUser, analytics };
