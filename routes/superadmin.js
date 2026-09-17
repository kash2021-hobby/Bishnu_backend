const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { User, Department, Business, Task, Project } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

// Middleware to ensure user is SuperAdmin or Founder
const superAdminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'SuperAdmin' || req.user.role === 'Founder')) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Access denied: SuperAdmin permission required.' });
};

// 1. GET /api/superadmin/stats — System-wide analytics for SuperAdmin
router.get('/stats', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const totalAdmins = await User.count({ where: { role: 'Admin' } });
    const pendingAdmins = await User.count({ where: { status: 'Pending' } });
    const totalCompanies = await Business.count();
    const totalDepartments = await Department.count();
    const totalUsers = await User.count();
    const totalTasks = await Task.count();

    return res.json({
      success: true,
      data: {
        totalAdmins,
        pendingAdmins,
        totalCompanies,
        totalDepartments,
        totalUsers,
        totalTasks
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/superadmin/admins — List all Admin accounts with managed counts
router.get('/admins', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const admins = await User.findAll({
      where: {
        [Op.or]: [
          { role: { [Op.in]: ['Admin', 'SuperAdmin', 'Founder'] } },
          { status: 'Pending' }
        ]
      },
      order: [['created_at', 'DESC']]
    });

    const allCompanies = await Business.findAll();
    const allDepartments = await Department.findAll();
    const allUsers = await User.findAll();

    const result = admins.map(admin => {
      const adminId = admin.user_id;
      const adminEmail = (admin.email || '').toLowerCase();

      // Count Companies managed/created by Admin
      const managedCompanies = allCompanies.filter(c => c.created_by === adminId || (admin.business_entities || '').includes(c.name));
      
      // Count Departments managed by Admin
      const managedDepts = allDepartments.filter(d => (d.admin_email || '').toLowerCase() === adminEmail || d.admin_id === adminId);

      // Count Users in Admin's departments/companies
      const managedUsers = allUsers.filter(u => u.role !== 'SuperAdmin' && u.role !== 'Founder');

      return {
        id: admin.id,
        user_id: admin.user_id,
        full_name: admin.full_name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        status: admin.status || 'Active',
        business_entities: admin.business_entities,
        approved_by: admin.approved_by,
        created_at: admin.created_at,
        form_builder_enabled: Boolean(admin.form_builder_enabled),
        companiesCount: managedCompanies.length || (allCompanies.length > 0 ? allCompanies.length : 0),
        departmentsCount: managedDepts.length || (allDepartments.length > 0 ? allDepartments.length : 0),
        usersCount: managedUsers.length
      };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/superadmin/admins — SuperAdmin directly creates an Admin account
router.post('/admins', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { email, password, fullName, phone, businessEntities } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ success: false, error: 'Email, password, and full name are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ where: { email: cleanEmail } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email address is already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newAdmin = await User.create({
      user_id: 'USR_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      email: cleanEmail,
      password_hash: hashedPassword,
      full_name: fullName.trim(),
      role: 'Admin',
      phone: phone || null,
      business_entities: businessEntities ? (Array.isArray(businessEntities) ? businessEntities.join(', ') : businessEntities) : null,
      status: 'Active',
      approved_by: req.user.full_name || req.user.email,
      is_password_set: true
    });

    return res.json({
      success: true,
      message: `Admin account for ${newAdmin.full_name} created successfully!`,
      data: newAdmin
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PUT /api/superadmin/admins/:userId/approve — Approve pending Admin account
router.put('/admins/:userId/approve', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findOne({ where: { user_id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Admin user not found' });
    }

    await user.update({
      status: 'Active',
      approved_by: req.user.full_name || req.user.email
    });

    return res.json({
      success: true,
      message: `Admin account for ${user.full_name} has been approved and activated!`,
      data: user
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. PUT /api/superadmin/admins/:userId/status — Enable or Disable Admin account
router.put('/admins/:userId/status', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    
    if (!['Active', 'Disabled', 'Inactive'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status value' });
    }

    const user = await User.findOne({ where: { user_id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Admin user not found' });
    }

    await user.update({ status });

    return res.json({
      success: true,
      message: `Admin account status updated to ${status}.`,
      data: user
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. DELETE /api/superadmin/admins/:userId — Delete Admin account
router.delete('/admins/:userId', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findOne({ where: { user_id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Admin user not found' });
    }

    if (user.role === 'SuperAdmin' || user.role === 'Founder') {
      return res.status(400).json({ success: false, error: 'Cannot delete a Master SuperAdmin account.' });
    }

    await user.destroy();

    return res.json({
      success: true,
      message: `Admin account for ${user.full_name} has been deleted.`
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. PATCH /api/superadmin/admins/:userId/form-builder — Toggle Form Builder for an admin account
// When enabled for an owner, ALL companies under that owner use the custom task form.
router.patch('/admins/:userId/form-builder', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled } = req.body;

    const user = await User.findOne({ where: { user_id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Admin user not found' });
    }

    if (user.role === 'SuperAdmin' || user.role === 'Founder') {
      return res.status(400).json({ success: false, error: 'Cannot modify SuperAdmin accounts.' });
    }

    await user.update({ form_builder_enabled: Boolean(enabled) });

    return res.json({
      success: true,
      message: `Form Builder ${enabled ? 'enabled' : 'disabled'} for ${user.full_name}. All companies under this account will ${enabled ? 'use' : 'revert to'} the custom task form.`,
      data: { user_id: user.user_id, form_builder_enabled: Boolean(enabled) }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
