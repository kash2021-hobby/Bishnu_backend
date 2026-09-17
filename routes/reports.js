const express = require('express');
const router = express.Router();
const { Task, User, Department } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

// 1. GET /api/reports — Overview & Analytics
router.get('/', authMiddleware, async (req, res) => {
  try {
    const currentUser = req.user;
    let allTasks = await Task.findAll();
    let allUsers = await User.findAll();

    const isSuper = ['SuperAdmin', 'Founder'].includes(currentUser.role);
    if (!isSuper) {
      const adminUserId = String(currentUser.user_id || '').trim().toLowerCase();
      const adminEmail = String(currentUser.email || '').trim().toLowerCase();
      const userBizStr = currentUser.business_entities || '';
      const userBizs = userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      // Find all users belonging to the SAME organization
      const sameOrgUsers = allUsers.filter(u => {
        if (u.user_id === currentUser.user_id || u.email === currentUser.email) return true;
        if (u.approved_by === currentUser.user_id || u.approved_by === currentUser.email) return true;
        const uBizs = (u.business_entities || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        return userBizs.length > 0 && userBizs.some(b => uBizs.includes(b));
      });
      const sameOrgUserIds = [adminUserId, ...sameOrgUsers.map(u => String(u.user_id || '').toLowerCase())];
      const sameOrgEmails = [adminEmail, ...sameOrgUsers.map(u => String(u.email || '').toLowerCase())].filter(Boolean);

      if (currentUser.role === 'Admin') {
        allTasks = allTasks.filter(t => {
          const createdBy = String(t.created_by || '').trim().toLowerCase();
          const isCreatorMatch = sameOrgUserIds.includes(createdBy) || sameOrgEmails.includes(createdBy);
          const tBiz = String(t.business_entity || '').trim().toLowerCase();
          const isBizMatch = userBizs.length > 0 && tBiz && userBizs.some(b => b === tBiz || tBiz.includes(b));
          return isCreatorMatch || isBizMatch;
        });

        allUsers = sameOrgUsers;

      } else if (currentUser.role === 'DeptAdmin') {
        const userDept = (currentUser.department || '').trim().toLowerCase();
        allTasks = allTasks.filter(t => {
          const createdBy = String(t.created_by || '').trim().toLowerCase();
          const isOrgMatch = sameOrgUserIds.includes(createdBy) || sameOrgEmails.includes(createdBy);
          const tBiz = String(t.business_entity || '').trim().toLowerCase();
          const isBizMatch = userBizs.length > 0 && tBiz && userBizs.some(b => b === tBiz || tBiz.includes(b));
          const tDept = (t.department || '').trim().toLowerCase();

          return (isOrgMatch || isBizMatch) && (tDept === userDept || userDept.includes(tDept));
        });

        allUsers = sameOrgUsers.filter(u => {
          const uDept = (u.department || '').trim().toLowerCase();
          return uDept === userDept || String(u.user_id || '').trim().toLowerCase() === adminUserId;
        });

      } else {
        // TeamMember
        allTasks = allTasks.filter(t => String(t.assigned_to || '').includes(currentUser.user_id));
        allUsers = allUsers.filter(u => u.user_id === currentUser.user_id);
      }
    }

    const total = allTasks.length;
    const completed = allTasks.filter(t => t.status === 'Completed').length;
    const inProgress = allTasks.filter(t => t.status === 'In Progress').length;
    const notStarted = allTasks.filter(t => t.status === 'Not Started').length;

    let totalPoints = 0;
    let completedPoints = 0;

    allTasks.forEach(t => {
      const sp = parseFloat(t.story_points) || 0;
      totalPoints += sp;
      if (t.status === 'Completed') {
        completedPoints += sp;
      }
    });

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const spBurnRate = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;

    // Pace distribution
    const paceStats = { OnTrack: 0, AtRisk: 0, OffTrack: 0 };
    allTasks.forEach(t => {
      if (t.pace_status === 'On Track') paceStats.OnTrack++;
      else if (t.pace_status === 'At Risk') paceStats.AtRisk++;
      else if (t.pace_status === 'Off Track') paceStats.OffTrack++;
    });

    // Priority breakdown
    const priorityStats = { High: 0, Medium: 0, Low: 0 };
    allTasks.forEach(t => {
      const p = t.priority || 'Medium';
      if (priorityStats[p] !== undefined) priorityStats[p]++;
    });

    // Department breakdown
    const deptMap = {};
    allTasks.forEach(t => {
      const d = t.department || 'Operations';
      if (!deptMap[d]) deptMap[d] = { name: d, total: 0, completed: 0, inProgress: 0, storyPoints: 0 };
      deptMap[d].total++;
      deptMap[d].storyPoints += (parseFloat(t.story_points) || 0);
      if (t.status === 'Completed') deptMap[d].completed++;
      if (t.status === 'In Progress') deptMap[d].inProgress++;
    });

    // User/Member workload breakdown
    const memberStats = allUsers.map(u => {
      const uTasks = allTasks.filter(t => t.assigned_to === u.user_id || (t.assigned_to && t.assigned_to.includes(u.user_id)));
      const uCompleted = uTasks.filter(t => t.status === 'Completed').length;
      const uTotalSP = uTasks.reduce((sum, t) => sum + (parseFloat(t.story_points) || 0), 0);
      const uCompletedSP = uTasks.filter(t => t.status === 'Completed').reduce((sum, t) => sum + (parseFloat(t.story_points) || 0), 0);

      return {
        userId: u.user_id,
        name: u.full_name || u.email,
        email: u.email,
        department: u.department || 'Operations',
        totalTasks: uTasks.length,
        completedTasks: uCompleted,
        totalStoryPoints: uTotalSP,
        completedStoryPoints: uCompletedSP
      };
    });

    return res.json({
      success: true,
      data: {
        summary: {
          totalTasks: total,
          completedTasks: completed,
          inProgressTasks: inProgress,
          notStartedTasks: notStarted,
          completionRate,
          totalStoryPoints: totalPoints,
          completedStoryPoints: completedPoints,
          spBurnRate
        },
        paceStats,
        priorityStats,
        departmentBreakdown: Object.values(deptMap),
        memberBreakdown: memberStats
      }
    });
  } catch (err) {
    console.error('Reports endpoint error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/reports/capacity — Workload & Capacity Orchestration Data
router.get('/capacity', authMiddleware, async (req, res) => {
  try {
    const currentUser = req.user;
    let depts = await Department.findAll({ order: [['name', 'ASC']] });
    let allUsers = await User.findAll({ where: { status: 'Active' } });
    let allTasks = await Task.findAll({ where: { status: { [Op.ne]: 'Completed' } } });

    const isSuper = ['SuperAdmin', 'Founder'].includes(currentUser.role);

    if (!isSuper) {
      const userBizStr = currentUser.business_entities || '';
      const userBizs = userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      // Filter users by organization
      allUsers = allUsers.filter(u => {
        if (u.user_id === currentUser.user_id || u.email === currentUser.email) return true;
        if (u.approved_by === currentUser.user_id || u.approved_by === currentUser.email) return true;
        const uBizs = (u.business_entities || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        return userBizs.length > 0 && userBizs.some(b => uBizs.includes(b));
      });

      const sameOrgUserIds = allUsers.map(u => String(u.user_id || '').toLowerCase());
      const sameOrgEmails = allUsers.map(u => String(u.email || '').toLowerCase());

      // Filter tasks by organization
      allTasks = allTasks.filter(t => {
        const createdBy = String(t.created_by || '').trim().toLowerCase();
        const isOrgMatch = sameOrgUserIds.includes(createdBy) || sameOrgEmails.includes(createdBy);
        const tBiz = String(t.business_entity || '').trim().toLowerCase();
        const isBizMatch = userBizs.length > 0 && tBiz && userBizs.some(b => b === tBiz || tBiz.includes(b));
        return isOrgMatch || isBizMatch;
      });

      // Filter departments by organization
      depts = depts.filter(d => {
        const dBizStr = d.business_entities || '';
        const dBizs = dBizStr ? dBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        const hasBizMatch = userBizs.length > 0 && dBizs.some(db => userBizs.includes(db));
        return hasBizMatch || d.admin_id === currentUser.user_id || d.admin_email === currentUser.email;
      });
    }

    // If no custom departments exist in DB yet for this company, generate virtual capacity cards from active users/tasks
    if (depts.length === 0) {
      const deptNames = Array.from(new Set(allUsers.map(u => u.department || 'General'))).filter(Boolean);
      if (deptNames.length === 0) deptNames.push('General');

      depts = deptNames.map((dName, idx) => ({
        department_id: `DPT_${idx + 1}`,
        name: dName,
        icon: '🏢',
        color: '#4f46e5',
        daily_working_hours: 8,
        minutes_per_story_point: 60
      }));
    }

    const formattedData = depts.map(d => {
      const cleanDeptName = (d.name || '').trim().toLowerCase();

      // Find employees belonging to this department
      const deptEmployees = allUsers.filter(u => {
        const userDeptStr = (u.department || '').trim().toLowerCase();
        const userDepts = userDeptStr.split(',').map(s => s.trim());
        return userDepts.some(ud => ud === cleanDeptName || (ud && cleanDeptName && (ud.includes(cleanDeptName) || cleanDeptName.includes(ud))));
      });

      const empCount = Math.max(1, deptEmployees.length);
      const dailyHours = parseFloat(d.daily_working_hours) || 8.0;
      const minsPerSP = parseInt(d.minutes_per_story_point, 10) || 60;

      // Weekly Capacity calculation: (Hours * 60 / minsPerSP) * 5 days per employee
      const empMaxWeeklySP = Math.round(((dailyHours * 60 / minsPerSP) * 5) * 10) / 10;
      const totalWeeklyCapacitySP = Math.round((empMaxWeeklySP * empCount) * 10) / 10;

      // Calculate employee breakdown and department occupied SP
      let deptOccupiedSP = 0;
      const empBreakdown = deptEmployees.map(u => {
        const uTasks = allTasks.filter(t => t.assigned_to === u.user_id || (t.assigned_to && t.assigned_to.includes(u.user_id)));
        const empOccupiedSP = uTasks.reduce((sum, t) => sum + (parseFloat(t.story_points) || 1), 0);
        deptOccupiedSP += empOccupiedSP;
        const capacityPct = empMaxWeeklySP > 0 ? Math.min(100, Math.round((empOccupiedSP / empMaxWeeklySP) * 100)) : 0;

        return {
          UserId: u.user_id,
          FullName: u.full_name || u.email,
          Role: u.role,
          AssignedTaskCount: uTasks.length,
          OccupiedSP: Math.round(empOccupiedSP * 10) / 10,
          MaxWeeklySP: empMaxWeeklySP,
          CapacityPct: capacityPct
        };
      });

      // Also add unassigned tasks for this department to occupied SP
      const deptUnassignedTasks = allTasks.filter(t => {
        const tDept = (t.department || '').trim().toLowerCase();
        return (tDept === cleanDeptName || cleanDeptName.includes(tDept)) && (!t.assigned_to || t.assigned_to === '');
      });
      const unassignedSP = deptUnassignedTasks.reduce((sum, t) => sum + (parseFloat(t.story_points) || 1), 0);
      deptOccupiedSP += unassignedSP;

      const freeSP = Math.max(0, Math.round((totalWeeklyCapacitySP - deptOccupiedSP) * 10) / 10);
      const utilizationPct = totalWeeklyCapacitySP > 0 ? Math.min(100, Math.round((deptOccupiedSP / totalWeeklyCapacitySP) * 100)) : 0;

      return {
        DepartmentID: d.department_id,
        DepartmentName: d.name,
        Icon: d.icon || '🏢',
        Color: d.color || '#4f46e5',
        EmployeeCount: empCount,
        DailyWorkingHours: dailyHours,
        MinutesPerStoryPoint: minsPerSP,
        TotalWeeklyCapacitySP: totalWeeklyCapacitySP,
        OccupiedSP: Math.round(deptOccupiedSP * 10) / 10,
        FreeSP: freeSP,
        UtilizationPct: utilizationPct,
        EmployeeBreakdown: empBreakdown
      };
    });

    return res.json({ success: true, data: formattedData });
  } catch (err) {
    console.error('Fetch capacity data error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
