const express = require('express');
const router = express.Router();
const { Department, Task, User } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

// 1. Get All Departments
router.get('/', authMiddleware, async (req, res) => {
  try {
    let depts = await Department.findAll({ order: [['name', 'ASC']] });

    const isSuper = ['SuperAdmin', 'Founder'].includes(req.user.role);
    if (!isSuper) {
      const uIdLower = String(req.user?.user_id || '').trim().toLowerCase();
      const uEmailLower = String(req.user?.email || '').trim().toLowerCase();
      const userBizStr = req.user?.business_entities || '';
      const userAssignedBizs = userBizStr ? userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

      depts = depts.filter(d => {
        const dAdminLower = String(d.admin_id || '').trim().toLowerCase();
        const dEmailLower = String(d.admin_email || '').trim().toLowerCase();

        const dAdminMatch = Boolean(
          (uIdLower && dAdminLower === uIdLower) ||
          (uEmailLower && (dAdminLower === uEmailLower || dEmailLower === uEmailLower))
        );

        const dBizStr = d.business_entities || '';
        const dBizs = dBizStr ? dBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

        // Department belongs to user's assigned business entities or is shared across entities
        const hasBizMatch = userAssignedBizs.length > 0 && (
          dBizs.length === 0 ||
          dBizs.some(db => userAssignedBizs.includes(db) || db === 'all' || db.includes('shared')) ||
          userAssignedBizs.some(ub => dBizs.some(db => db.includes(ub) || ub.includes(db)))
        );

        // Check if user's own assigned department matches
        const userDeptStr = (req.user?.department || '').trim().toLowerCase();
        const userDepts = userDeptStr.split(',').map(s => s.trim()).filter(Boolean);
        const cleanDeptName = (d.name || '').trim().toLowerCase();
        const deptMatch = userDepts.some(ud => ud === cleanDeptName || cleanDeptName.includes(ud) || ud.includes(cleanDeptName));

        // If user is Admin or Founder, they have access to all departments in their business entities
        if (req.user?.role === 'Admin' || req.user?.role === 'Founder') {
          return dAdminMatch || hasBizMatch || dBizs.length === 0;
        }

        return dAdminMatch || hasBizMatch || deptMatch || dBizs.length === 0;
      });
    }

    const allUsers = await User.findAll({ where: { status: 'Active' } });

    const formattedDepts = depts.map(d => {
      // Count active employees & Dept Head assigned to this department
      const deptUsers = allUsers.filter(u => {
        const cleanDeptName = (d.name || '').trim().toLowerCase();
        const userDeptStr = (u.department || '').trim().toLowerCase();
        const userDepts = userDeptStr.split(',').map(s => s.trim());

        const matchesDept = userDepts.some(ud =>
          ud === cleanDeptName ||
          (ud && cleanDeptName && (ud.includes(cleanDeptName) || cleanDeptName.includes(ud))) ||
          (cleanDeptName.includes('tech') && ud.includes('tech'))
        );

        const isHeadEmail = u.email && d.admin_email && u.email.trim().toLowerCase() === d.admin_email.trim().toLowerCase();
        const isHeadName = u.full_name && d.admin_name && u.full_name.trim().toLowerCase() === d.admin_name.trim().toLowerCase();

        return matchesDept || isHeadEmail || isHeadName;
      });
      const empCount = deptUsers.length;
      const dailyHours = parseFloat(d.daily_working_hours) || 8.0;
      const minsPerSP = parseInt(d.minutes_per_story_point, 10) || 60;

      const totalDailyMinutes = empCount * dailyHours * 60;
      const dailySP = minsPerSP > 0 ? Math.round((totalDailyMinutes / minsPerSP) * 10) / 10 : 0;
      const weeklySP = Math.round((dailySP * 5) * 10) / 10;
      const monthlySP = Math.round((dailySP * 22) * 10) / 10;

      return {
        DepartmentID: d.department_id,
        Name: d.name,
        Description: d.description || '',
        AdminName: d.admin_name || '',
        AdminEmail: d.admin_email || '',
        Icon: d.icon,
        Color: d.color,
        TelegramChatId: d.telegram_chat_id || '',
        TelegramBotToken: d.telegram_bot_token || '',
        MinutesPerStoryPoint: minsPerSP,
        DailyWorkingHours: dailyHours,
        EmployeeCount: empCount,
        DailyStoryPointsCapacity: dailySP,
        WeeklyStoryPointsCapacity: weeklySP,
        MonthlyStoryPointsCapacity: monthlySP,
        BusinessEntities: d.business_entities || ''
      };
    });

    return res.json({ success: true, data: formattedDepts });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Add New Department
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, businessEntities, headName, headEmail, icon, color, telegramChatId, minutesPerStoryPoint, dailyWorkingHours } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Department name is required' });
    }

    const cleanName = name.trim();

    // Check existing name for this admin
    const depts = await Department.findAll();
    const existing = depts.find(d =>
      (d.name || '').trim().toLowerCase() === cleanName.toLowerCase() &&
      (d.admin_id === req.user.user_id || d.admin_email === req.user.email)
    );

    if (existing) {
      return res.status(400).json({ success: false, error: `Department "${cleanName}" already exists in your organization.` });
    }

    const newDept = await Department.create({
      department_id: 'DPT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: cleanName,
      description: description || '',
      business_entities: Array.isArray(businessEntities) ? businessEntities.join(', ') : (businessEntities || ''),
      admin_id: req.user.user_id || req.user.email,
      admin_name: headName || '',
      admin_email: headEmail || '',
      icon: icon || '🏢',
      color: color || '#8b5cf6',
      telegram_chat_id: telegramChatId || process.env.TELEGRAM_DEFAULT_CHAT_ID,
      minutes_per_story_point: minutesPerStoryPoint ? parseInt(minutesPerStoryPoint, 10) : 60,
      daily_working_hours: dailyWorkingHours ? parseFloat(dailyWorkingHours) : 8.0,
      status: 'Active'
    });

    // Auto-register or upgrade Dept Head in Users table
    if (headEmail && headEmail.trim()) {
      const cleanHeadEmail = headEmail.trim().toLowerCase();
      let headUser = await User.findOne({ where: { email: cleanHeadEmail } });
      const deptBiz = Array.isArray(businessEntities) ? businessEntities.join(', ') : (businessEntities || req.user?.business_entities || '');
      const creatorId = req.user?.user_id || req.user?.email;

      if (!headUser) {
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await User.create({
          user_id: 'USR_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          email: cleanHeadEmail,
          password_hash: hashedPassword,
          full_name: (headName || cleanHeadEmail.split('@')[0]).trim(),
          role: 'DeptAdmin',
          department: cleanName,
          business_entities: deptBiz,
          approved_by: creatorId,
          status: 'Active',
          is_password_set: false
        });
      } else {
        await headUser.update({
          role: ['Admin', 'SuperAdmin', 'Founder'].includes(headUser.role) ? headUser.role : 'DeptAdmin',
          department: cleanName,
          business_entities: deptBiz || headUser.business_entities,
          approved_by: creatorId,
          full_name: headName ? headName.trim() : headUser.full_name
        });
      }
    }

    return res.json({ success: true, data: newDept, message: 'Department created successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Update Department Details
router.put('/:departmentId', authMiddleware, async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { name, description, businessEntities, headName, headEmail, icon, color, telegramChatId, minutesPerStoryPoint, dailyWorkingHours } = req.body;

    const targetLower = String(departmentId).trim().toLowerCase();

    const depts = await Department.findAll();
    const dept = depts.find(d =>
      String(d.department_id || '').toLowerCase() === targetLower ||
      String(d.name || '').toLowerCase() === targetLower ||
      String(d.id) === targetLower
    );

    if (!dept) return res.status(404).json({ success: false, error: `Department "${departmentId}" not found` });

    const updateFields = {};
    if (name) updateFields.name = name.trim();
    if (description !== undefined) updateFields.description = description;
    if (businessEntities !== undefined) {
      updateFields.business_entities = Array.isArray(businessEntities) ? businessEntities.join(', ') : businessEntities;
    }
    if (headName !== undefined) updateFields.admin_name = headName;
    if (headEmail !== undefined) updateFields.admin_email = headEmail;
    if (icon) updateFields.icon = icon;
    if (color) updateFields.color = color;
    if (telegramChatId !== undefined) updateFields.telegram_chat_id = telegramChatId;
    if (minutesPerStoryPoint !== undefined) updateFields.minutes_per_story_point = parseInt(minutesPerStoryPoint, 10) || 60;
    if (dailyWorkingHours !== undefined) updateFields.daily_working_hours = parseFloat(dailyWorkingHours) || 8.0;

    await dept.update(updateFields);

    // Auto-register or upgrade Dept Head in Users table
    if (headEmail && headEmail.trim()) {
      const cleanHeadEmail = headEmail.trim().toLowerCase();
      let headUser = await User.findOne({ where: { email: cleanHeadEmail } });
      const deptBiz = dept.business_entities || req.user?.business_entities || '';
      const creatorId = req.user?.user_id || req.user?.email;

      if (!headUser) {
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await User.create({
          user_id: 'USR_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          email: cleanHeadEmail,
          password_hash: hashedPassword,
          full_name: (headName || cleanHeadEmail.split('@')[0]).trim(),
          role: 'DeptAdmin',
          department: dept.name,
          business_entities: deptBiz,
          approved_by: creatorId,
          status: 'Active',
          is_password_set: false
        });
      } else {
        await headUser.update({
          role: ['Admin', 'SuperAdmin', 'Founder'].includes(headUser.role) ? headUser.role : 'DeptAdmin',
          department: dept.name,
          business_entities: deptBiz || headUser.business_entities,
          approved_by: creatorId,
          full_name: headName ? headName.trim() : headUser.full_name
        });
      }
    }
    return res.json({ success: true, message: 'Department updated successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Update Department Telegram Settings
router.put('/:departmentId/telegram', authMiddleware, async (req, res) => {
  try {
    const { departmentId } = req.params;
    let { telegramChatId, telegramBotToken } = req.body;

    const dept = await Department.findOne({
      where: {
        [Op.or]: [
          { department_id: departmentId },
          { name: departmentId }
        ]
      }
    });

    if (!dept) return res.status(404).json({ success: false, error: 'Department not found' });

    let cleanChatId = (telegramChatId || '').trim().replace(/[\r\n\t]/g, '');
    let cleanBotToken = (telegramBotToken || '').trim().replace(/[\r\n\t]/g, '');

    // Auto-map upgraded Supergroup ID if old group ID -5134106990 is entered
    if (cleanChatId === '-5134106990') {
      cleanChatId = '-1004485229628';
    }

    await dept.update({
      telegram_chat_id: cleanChatId || null,
      telegram_bot_token: cleanBotToken || null
    });

    return res.json({ success: true, message: 'Telegram settings updated successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Get Dynamic Dashboard Real-Time KPI Metrics
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const { departmentId, businessEntity } = req.query;
    const currentUser = req.user;
    const isSuper = ['SuperAdmin', 'Founder'].includes(currentUser.role);
    const targetDept = departmentId || currentUser.department || (isSuper ? 'ALL' : 'Operations');

    let allTasks = await Task.findAll();
    let allUsers = await User.findAll({ where: { status: 'Active' } });

    const isTaskAssignedToUser = (t, user) => {
      if (!t || !t.assigned_to) return false;
      const raw = String(t.assigned_to).trim().toLowerCase();
      if (!raw || raw === 'unassigned') return false;

      const uid = String(user.user_id || '').trim().toLowerCase();
      const uemail = String(user.email || '').trim().toLowerCase();
      const ufullname = String(user.full_name || user.name || '').trim().toLowerCase();

      const assignees = raw.split(',').map(s => s.trim());
      return assignees.some(a =>
        (uid && (a === uid || a.includes(uid))) ||
        (uemail && (a === uemail || a.includes(uemail))) ||
        (ufullname && (a === ufullname || ufullname.includes(a) || a.includes(ufullname)))
      );
    };

    if (!isSuper) {
      const userBizStr = currentUser.business_entities || '';
      const userBizs = userBizStr ? userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

      allTasks = allTasks.filter(t => {
        const tBiz = (t.business_entity || '').trim().toLowerCase();
        const matchesBiz = userBizs.length > 0 && userBizs.includes(tBiz);
        const matchesCreator = (t.assigned_by === currentUser.user_id || t.assigned_by === currentUser.email);
        return matchesBiz || matchesCreator || isTaskAssignedToUser(t, currentUser);
      });

      allUsers = allUsers.filter(u => {
        if (u.user_id === currentUser.user_id || u.email === currentUser.email) return true;
        if (u.approved_by && (u.approved_by === currentUser.user_id || u.approved_by === currentUser.email)) return true;
        const uBizStr = u.business_entities || '';
        const uBizs = uBizStr ? uBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        return userBizs.length > 0 && uBizs.some(b => userBizs.includes(b));
      });
    }

    const isAllDept = targetDept === 'ALL' || targetDept.toLowerCase() === 'all';
    const isAllBiz = !businessEntity || businessEntity === 'ALL' || businessEntity === '';

    const matchesBiz = (tBiz, targetBiz) => {
      if (!targetBiz || targetBiz === 'ALL' || targetBiz.toLowerCase() === 'all') return true;
      if (!tBiz || tBiz === 'Company X (Shared)') return true;
      const bLower = targetBiz.trim().toLowerCase();
      const tbLower = tBiz.trim().toLowerCase();
      return tbLower === bLower || tbLower.includes(bLower) || bLower.includes(tbLower);
    };

    const matchesDept = (tDept, targetDept) => {
      if (!targetDept || targetDept === 'ALL' || targetDept.toLowerCase() === 'all') return true;
      if (!tDept) return true;
      const dLower = targetDept.trim().toLowerCase();
      const tdLower = tDept.trim().toLowerCase();
      return tdLower === dLower || tdLower.includes(dLower) || dLower.includes(tdLower);
    };

    // Filter Tasks for selected Department / Scope / Role
    let deptTasks = allTasks;

    if (currentUser.role === 'TeamMember') {
      // Employee: strictly ONLY tasks assigned to them, filtered by topbar company & dept if selected
      deptTasks = allTasks.filter(t => isTaskAssignedToUser(t, currentUser) && matchesBiz(t.business_entity, businessEntity) && matchesDept(t.department, targetDept));
    } else if (currentUser.role === 'DeptAdmin') {
      // Dept Head: ONLY tasks of their department OR assigned to them, filtered by company & dept
      const userDept = currentUser.department || targetDept;
      const userDepts = String(userDept).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      deptTasks = allTasks.filter(t => {
        const tDept = String(t.department || '').trim().toLowerCase();
        const matchesUserDept = userDepts.some(d => tDept === d || tDept.includes(d) || d.includes(tDept));
        const isInScope = matchesUserDept || isTaskAssignedToUser(t, currentUser);
        return isInScope && matchesBiz(t.business_entity, businessEntity) && matchesDept(t.department, targetDept);
      });
    } else {
      deptTasks = allTasks.filter(t => {
        return matchesBiz(t.business_entity, businessEntity) && matchesDept(t.department, targetDept);
      });
    }

    // Filter Active Members
    const members = allUsers.filter(u => {
      if (!isAllDept) {
        const uDept = (u.department || '').trim().toLowerCase();
        const targetLower = targetDept.trim().toLowerCase();
        if (uDept !== targetLower && !uDept.includes(targetLower)) return false;
      }
      if (!isAllBiz) {
        const uBizStr = (u.business_entities || u.BusinessEntities || '').trim().toLowerCase();
        if (uBizStr && !uBizStr.includes(businessEntity.toLowerCase())) return false;
      }
      return true;
    });

    const isEmployee = currentUser.role === 'TeamMember';
    const unassignedTasks = isEmployee ? [] : deptTasks.filter(t => (!t.assigned_to || t.assigned_to === '' || t.assigned_to === 'Unassigned') && t.status !== 'Completed');
    const myTasks = allTasks.filter(t => isTaskAssignedToUser(t, currentUser) && t.status !== 'Completed');
    const overdueTasks = deptTasks.filter(t => t.pace_status === 'Delayed' && t.status !== 'Completed');
    const completedTasks = deptTasks.filter(t => t.status === 'Completed');

    const stats = {
      totalTasks: deptTasks.length,
      unassignedCount: isEmployee ? 0 : unassignedTasks.length,
      myTaskCount: myTasks.length,
      completedTasks: completedTasks.length,
      overdue: overdueTasks.length,
      memberCount: members.length
    };

    return res.json({
      success: true,
      data: {
        department: {
          Name: isAllDept ? 'All Company Departments' : targetDept,
          Icon: '🏢'
        },
        currentUserRole: currentUser.role,
        myTasks: myTasks.map(t => ({ ...t.get({ plain: true }), TaskID: t.task_id, Title: t.title, Status: t.status, Priority: t.priority, DueDate: t.due_date, BusinessEntity: t.business_entity })),
        unassignedTasks: unassignedTasks.map(t => ({ ...t.get({ plain: true }), TaskID: t.task_id, Title: t.title, Status: t.status, Priority: t.priority, BusinessEntity: t.business_entity })),
        deptTasks: deptTasks.map(t => ({ ...t.get({ plain: true }), TaskID: t.task_id, Title: t.title, Status: t.status })),
        overdueTasks: overdueTasks.map(t => ({ ...t.get({ plain: true }), TaskID: t.task_id, Title: t.title })),
        members: members.map(m => ({ UserID: m.user_id, FullName: m.full_name, Email: m.email, Role: m.role, Department: m.department })),
        stats
      }
    });
  } catch (err) {
    console.error('Dashboard data error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Department (SuperAdmin / Founder / Admin)
router.delete('/:departmentId', authMiddleware, async (req, res) => {
  try {
    const isSuperOrAdmin = ['SuperAdmin', 'Founder', 'Admin'].includes(req.user.role);
    if (!isSuperOrAdmin) {
      return res.status(403).json({ success: false, error: 'Only Admins can delete departments' });
    }

    const { departmentId } = req.params;
    const targetLower = String(departmentId).trim().toLowerCase();

    const depts = await Department.findAll();
    const dept = depts.find(d =>
      String(d.department_id || '').toLowerCase() === targetLower ||
      String(d.name || '').toLowerCase() === targetLower ||
      String(d.id) === targetLower
    );

    if (!dept) {
      return res.status(404).json({ success: false, error: `Department "${departmentId}" not found` });
    }

    await dept.destroy();
    return res.json({ success: true, message: `Department "${dept.name}" deleted successfully` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
