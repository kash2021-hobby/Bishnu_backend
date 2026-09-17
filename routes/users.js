const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, async (req, res) => {
  try {
    const isSuper = ['SuperAdmin', 'Founder'].includes(req.user.role);
    const users = await User.findAll({
      where: { status: 'Active' },
      attributes: ['user_id', 'full_name', 'email', 'role', 'department', 'business_entities', 'phone', 'approved_by']
    });

    let filteredUsers = users;
    if (!isSuper) {
      const { Department } = require('../models');
      const { Op } = require('sequelize');

      const userId = req.user?.user_id;
      const userEmail = req.user?.email;
      const uIdLower = String(userId || '').trim().toLowerCase();
      const uEmailLower = String(userEmail || '').trim().toLowerCase();

      const userBizStr = req.user?.business_entities || '';
      const userAssignedBizs = userBizStr ? userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

      const orConds = [];
      if (userId) orConds.push({ admin_id: userId });
      if (userEmail) orConds.push({ admin_id: userEmail });

      const myDepts = orConds.length > 0 ? await Department.findAll({ where: { [Op.or]: orConds } }) : [];
      const myDeptNames = myDepts.map(d => (d.name || '').trim().toLowerCase()).filter(Boolean);

      filteredUsers = users.filter(u => {
        const targetIdLower = String(u.user_id || '').trim().toLowerCase();
        const targetEmailLower = String(u.email || '').trim().toLowerCase();
        const targetApprLower = String(u.approved_by || '').trim().toLowerCase();
        const targetDeptLower = String(u.department || '').trim().toLowerCase();

        if (uIdLower && targetIdLower === uIdLower) return true;
        if (uEmailLower && targetEmailLower === uEmailLower) return true;

        if (targetApprLower && ((uIdLower && targetApprLower === uIdLower) || (uEmailLower && targetApprLower === uEmailLower))) return true;

        if (targetDeptLower && myDeptNames.includes(targetDeptLower)) return true;

        const uBizStr = u.business_entities || '';
        const uBizs = uBizStr ? uBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        return userAssignedBizs.length > 0 && uBizs.some(b => userAssignedBizs.includes(b));
      });
    }

    const formattedUsers = filteredUsers.map(u => ({
      UserID: u.user_id,
      FullName: u.full_name,
      Email: u.email,
      Role: u.role,
      Department: u.department,
      BusinessEntities: u.business_entities || '',
      Phone: u.phone
    }));

    return res.json({ success: true, data: formattedUsers });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Add New Employee
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { email, fullName, role, department, businessEntities, phone } = req.body;
    if (!email || !fullName) {
      return res.status(400).json({ success: false, error: 'Email and Full Name are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ where: { email: cleanEmail } });
    if (existing) {
      return res.status(400).json({ success: false, error: `Employee with email "${cleanEmail}" already exists` });
    }

    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);

    const deptString = Array.isArray(department) ? department.join(', ') : (department || 'Operations');
    let bizString = Array.isArray(businessEntities) ? businessEntities.join(', ') : (businessEntities || '');

    if (!bizString && req.user && req.user.business_entities) {
      bizString = req.user.business_entities;
    }
    if (!bizString && req.user && req.user.full_name) {
      bizString = req.user.full_name.trim();
    }

    const newUser = await User.create({
      user_id: 'USR_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      email: cleanEmail,
      password_hash: hashedPassword,
      full_name: fullName.trim(),
      role: role || 'TeamMember',
      department: deptString,
      business_entities: bizString,
      phone: phone || '',
      approved_by: req.user.user_id || req.user.email,
      status: 'Active'
    });

    return res.json({ success: true, data: newUser, message: 'Employee added successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Update Employee Details
router.put('/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, email, role, department, businessEntities, phone, status } = req.body;

    const targetLower = String(userId).trim().toLowerCase();

    const users = await User.findAll();
    const user = users.find(u => 
      String(u.user_id || '').toLowerCase() === targetLower ||
      String(u.email || '').toLowerCase() === targetLower ||
      String(u.id) === targetLower
    );

    if (!user) return res.status(404).json({ success: false, error: `Employee "${userId}" not found` });

    const updateFields = {};
    if (fullName) updateFields.full_name = fullName.trim();
    if (email) updateFields.email = email.trim().toLowerCase();
    if (role) updateFields.role = role;
    if (department !== undefined) updateFields.department = Array.isArray(department) ? department.join(', ') : department;
    if (businessEntities !== undefined) updateFields.business_entities = Array.isArray(businessEntities) ? businessEntities.join(', ') : businessEntities;
    if (phone !== undefined) updateFields.phone = phone;
    if (status) updateFields.status = status;

    await user.update(updateFields);
    return res.json({ success: true, message: 'Employee updated successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Employee (SuperAdmin / Founder / Admin)
router.delete('/:userId', authMiddleware, async (req, res) => {
  try {
    const isSuperOrAdmin = ['SuperAdmin', 'Founder', 'Admin'].includes(req.user.role);
    if (!isSuperOrAdmin) {
      return res.status(403).json({ success: false, error: 'Only Admins can delete employees' });
    }

    const { userId } = req.params;
    const targetLower = String(userId).trim().toLowerCase();

    const users = await User.findAll();
    const user = users.find(u => 
      String(u.user_id || '').toLowerCase() === targetLower ||
      String(u.email || '').toLowerCase() === targetLower ||
      String(u.id) === targetLower
    );

    if (!user) {
      return res.status(404).json({ success: false, error: `Employee "${userId}" not found` });
    }

    // Prevent SuperAdmin from deleting their own active account
    if (user.user_id === req.user.user_id || user.email === req.user.email) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own active SuperAdmin account' });
    }

    await user.destroy();
    return res.json({ success: true, message: `Employee "${user.full_name}" deleted successfully` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Update Admin Telegram Bot Token & Chat ID
router.put('/profile/telegram', authMiddleware, async (req, res) => {
  try {
    const { telegramBotToken, telegramChatId } = req.body;
    const user = await User.findOne({ where: { user_id: req.user.user_id } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const updates = {};
    if (telegramBotToken !== undefined) updates.telegram_bot_token = telegramBotToken;
    if (telegramChatId !== undefined) updates.telegram_chat_id = telegramChatId;

    await user.update(updates);
    return res.json({
      success: true,
      message: 'Admin Telegram settings saved successfully!',
      data: {
        telegramBotToken: user.telegram_bot_token || '',
        telegramChatId: user.telegram_chat_id || ''
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Get Admin Telegram Bot Token & Chat ID
router.get('/profile/telegram', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ where: { user_id: req.user.user_id } });
    return res.json({
      success: true,
      data: {
        telegramBotToken: user?.telegram_bot_token || '',
        telegramChatId: user?.telegram_chat_id || ''
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Get Admin Google Drive Configuration
router.get('/profile/google-drive', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ where: { user_id: req.user.user_id } });
    return res.json({
      success: true,
      data: {
        googleDriveEnabled: !!user?.google_drive_enabled,
        parentFolderId: user?.google_drive_parent_folder_id || '',
        hasCredentials: !!user?.google_drive_credentials_json,
        credentialsJson: user?.google_drive_credentials_json || ''
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Update Admin Google Drive Configuration
router.put('/profile/google-drive', authMiddleware, async (req, res) => {
  try {
    const { parentFolderId, credentialsJson, enabled } = req.body;
    const user = await User.findOne({ where: { user_id: req.user.user_id } });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (credentialsJson && credentialsJson.trim()) {
      try {
        JSON.parse(credentialsJson.trim());
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid JSON format for Google Service Account credentials' });
      }
    }

    const hasCreds = credentialsJson && credentialsJson.trim().length > 0;
    const isEnabled = enabled !== undefined ? !!enabled : (hasCreds || !!user.google_drive_credentials_json);

    await user.update({
      google_drive_parent_folder_id: parentFolderId !== undefined ? parentFolderId.trim() : user.google_drive_parent_folder_id,
      google_drive_credentials_json: credentialsJson !== undefined ? credentialsJson.trim() : user.google_drive_credentials_json,
      google_drive_enabled: isEnabled
    });

    return res.json({
      success: true,
      message: 'Google Drive settings updated successfully!',
      data: {
        googleDriveEnabled: user.google_drive_enabled,
        parentFolderId: user.google_drive_parent_folder_id,
        hasCredentials: !!user.google_drive_credentials_json
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/users/google-calendar - Save Google Calendar URL for logged-in user
router.put('/google-calendar', authMiddleware, async (req, res) => {
  try {
    const { googleCalendarUrl } = req.body;
    await User.update(
      { google_calendar_url: googleCalendarUrl !== undefined ? String(googleCalendarUrl).trim() : '' },
      { where: { user_id: req.user.user_id } }
    );
    return res.json({ success: true, googleCalendarUrl: googleCalendarUrl || '' });
  } catch (err) {
    console.error('Error updating google calendar url:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
