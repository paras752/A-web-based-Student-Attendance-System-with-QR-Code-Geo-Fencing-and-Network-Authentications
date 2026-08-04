const { Router } = require('express');
const adminController = require('../controllers/admin.controller');
const { requireAuth } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');

const router = Router();

router.use(requireAuth, roleGuard('admin'));

router.get('/users', adminController.listUsers);
router.delete('/users/:id', adminController.deleteUser);
router.get('/analytics', adminController.analytics);

module.exports = router;
