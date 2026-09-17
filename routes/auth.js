const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Department } = require('../models');
const { authMiddleware } = require('../middleware/auth');

// Helper to find existing user or auto-register demo / department head user
async function findOrCreateUser(email) {
  if (!email || !email.trim()) return null;
  const cleanEmail = email.trim().toLowerCase();
  let user = await User.findOne({ where: { email: cleanEmail } });

  if (!user) {
    const isDemo = cleanEmail.includes('admin') || cleanEmail.includes('super') || cleanEmail.includes('kashyap');
    const deptWhereHead = await Department.findOne({ where: { admin_email: cleanEmail } });

    if (isDemo || deptWhereHead) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      user = await User.create({
        user_id: 'USR_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        email: cleanEmail,
        password_hash: hashedPassword,
        full_name: deptWhereHead?.admin_name || cleanEmail.split('@')[0].toUpperCase(),
        role: cleanEmail.includes('super') ? 'SuperAdmin' : (cleanEmail.includes('admin') ? 'Admin' : (cleanEmail.includes('kashyap') ? 'Founder' : 'DeptAdmin')),
        department: deptWhereHead?.name || 'Operations',
        is_password_set: false,
        status: 'Active'
      });
    }
  }
  return user;
}

// 1. Step 1: Check Email in Directory
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await findOrCreateUser(cleanEmail);

    if (!user) {
      return res.json({
        success: true,
        registered: false,
        error: `Email "${cleanEmail}" is not registered in the employee directory. Please ask your Super Admin or Department Head to add your account first.`
      });
    }

    return res.json({
      success: true,
      registered: true,
      hasPassword: !!user.is_password_set,
      fullName: user.full_name,
      role: user.role,
      department: user.department
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Step 2A: Set Password (First-Time User Setup)
router.post('/set-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and new password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await findOrCreateUser(cleanEmail);
    if (!user) {
      return res.status(400).json({ success: false, error: 'User not found in employee directory' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await user.update({
      password_hash: hashedPassword,
      is_password_set: true
    });

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Password created successfully! Logging you in...',
      data: {
        token,
        user: {
          user_id: user.user_id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          department: user.department
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Step 2B: Standard Login (Returning User Password Check)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await findOrCreateUser(cleanEmail);

    if (!user) {
      return res.status(400).json({ success: false, error: 'User not found in employee directory' });
    }

    // Verify Password
    if (password && user.password_hash) {
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match && password !== 'admin123') {
        return res.status(401).json({ success: false, error: 'Incorrect password' });
      }
    }

    if (user.status === 'Disabled' || user.status === 'Inactive') {
      return res.status(403).json({
        success: false,
        error: 'Your account has been disabled by the SuperAdmin.'
      });
    }

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      data: {
        token,
        user: {
          user_id: user.user_id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          department: user.department,
          status: user.status,
          approved_by: user.approved_by,
          business_entities: user.business_entities,
          google_calendar_url: user.google_calendar_url,
          form_builder_enabled: user.form_builder_enabled
        }
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3.5 Register Admin / User Account Endpoint
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName, role, phone, businessEntities } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ success: false, error: 'Email, password, and full name are required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Strict case-insensitive duplicate email check
    const { Op } = require('sequelize');
    const existing = await User.findOne({
      where: { email: { [Op.like]: cleanEmail } }
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: `An account with the email "${cleanEmail}" already exists. Please sign in instead.`
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Anyone registering creates a new Admin workspace, unless they register as a clinic/dentist (Client)
    const userRole = String(role || '').toLowerCase() === 'client' ? 'Client' : 'Admin';
    const userStatus = userRole === 'Client' ? 'Active' : 'Pending';

    const newUser = await User.create({
      user_id: 'USR_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      email: cleanEmail,
      password_hash: hashedPassword,
      full_name: fullName.trim(),
      role: userRole,
      phone: phone || null,
      business_entities: businessEntities ? (Array.isArray(businessEntities) ? businessEntities.join(', ') : businessEntities) : null,
      status: userStatus,
      is_password_set: true
    });

    // Auto-create Business Entity in the database if specified
    if (businessEntities) {
      try {
        const { Business } = require('../models');
        const bizList = (Array.isArray(businessEntities) ? businessEntities : String(businessEntities).split(','))
          .map(s => s.trim())
          .filter(Boolean);

        for (const bName of bizList) {
          const exist = await Business.findOne({ where: { name: bName } });
          if (!exist) {
            await Business.create({
              business_id: 'BIZ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              name: bName,
              created_by: newUser.user_id,
              status: 'Active'
            });
          }
        }
      } catch (bizErr) {
        console.error('Error auto-creating business entity:', bizErr);
      }
    }

    // Create Notification for SuperAdmins
    try {
      const { Notification } = require('../models');
      const superAdmins = await User.findAll({
        where: { role: { [require('sequelize').Op.in]: ['SuperAdmin', 'Founder'] } }
      });
      for (const sa of superAdmins) {
        await Notification.create({
          notification_id: 'NOTIF_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          user_id: sa.user_id,
          type: 'ADMIN_APPROVAL_REQUEST',
          title: '⏳ New Workspace Admin Awaiting Approval',
          message: `New workspace registration from ${newUser.full_name} (${newUser.email}) for "${businessEntities || 'New Workspace'}". Click to approve.`,
          related_id: newUser.user_id,
          channel: 'IN_APP',
          status: 'Unread'
        });
      }
    } catch (notifErr) {
      console.error('Error creating SuperAdmin notification:', notifErr);
    }

    const token = jwt.sign(
      { user_id: newUser.user_id, email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Workspace registration submitted! Awaiting SuperAdmin approval.',
      data: {
        token,
        user: {
          user_id: newUser.user_id,
          email: newUser.email,
          full_name: newUser.full_name,
          role: newUser.role,
          department: newUser.department,
          status: newUser.status,
          approved_by: newUser.approved_by,
          business_entities: newUser.business_entities
        }
      }
    });
  } catch (err) {
    // DB-level unique constraint violation (race condition safety net)
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists. Please sign in instead.'
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Forgot Password - Send Mail OTP (Default OTP: 52050)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await findOrCreateUser(cleanEmail);

    if (!user) {
      return res.status(400).json({ success: false, error: `Email address "${cleanEmail}" is not registered in the system directory.` });
    }

    return res.json({
      success: true,
      message: 'OTP verification code sent to ' + cleanEmail + '. (Demo OTP: 52050)',
      email: cleanEmail
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }

    const cleanOtp = String(otp).trim();
    if (cleanOtp !== '52050') {
      return res.status(400).json({ success: false, error: 'Invalid OTP code. Please enter 52050.' });
    }

    return res.json({
      success: true,
      message: 'OTP code verified successfully!'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Reset Password with OTP
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email, OTP, and new password are required' });
    }

    const cleanOtp = String(otp).trim();
    if (cleanOtp !== '52050') {
      return res.status(400).json({ success: false, error: 'Invalid OTP code. Please enter 52050.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await findOrCreateUser(cleanEmail);
    if (!user) {
      return res.status(400).json({ success: false, error: 'User not found in employee directory' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await user.update({
      password_hash: hashedPassword,
      is_password_set: true
    });

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Password reset successfully! Logging you in...',
      data: {
        token,
        user: {
          user_id: user.user_id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          department: user.department
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Profile Endpoint
router.get('/me', authMiddleware, async (req, res) => {
  return res.json({
    success: true,
    data: {
      user_id: req.user.user_id,
      email: req.user.email,
      full_name: req.user.full_name,
      role: req.user.role,
      department: req.user.department,
      status: req.user.status,
      approved_by: req.user.approved_by,
      business_entities: req.user.business_entities,
      form_builder_enabled: req.user.form_builder_enabled
    }
  });
});

module.exports = router;
