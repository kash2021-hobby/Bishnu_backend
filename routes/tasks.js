const express = require('express');
const router = express.Router();
const { Task, AuditLog, User, Department, Notification } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { sendTelegramTaskAssignment, forwardToClientChatroom } = require('../services/telegram');
const { Op } = require('sequelize');
const { stagesFor } = require('../lib/labStages');
const { resolveCaseType } = require('../lib/caseTypes');

function parseJsonField(value, fallback) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
}

function stringifyJsonField(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (err) {
    return null;
  }
}

function primaryCaseType(workTypes, fallback) {
  return resolveCaseType(fallback, workTypes);
}

function attachLabFields(plain) {
  const workTypes = parseJsonField(plain.work_types, []);
  const enclosures = parseJsonField(plain.enclosures, []);
  plain.CaseType = plain.case_type;
  plain.PatientName = plain.patient_name;
  plain.ToothNumbers = plain.tooth_numbers;
  plain.Shade = plain.shade;
  plain.ApprovalStatus = plain.approval_status;
  plain.RejectionReason = plain.rejection_reason;
  plain.LabStage = plain.lab_stage;
  plain.FormDate = plain.form_date;
  plain.DoctorName = plain.doctor_name;
  plain.HospitalName = plain.hospital_name;
  plain.PatientAge = plain.patient_age;
  plain.PatientSex = plain.patient_sex;
  plain.WorkTypes = workTypes;
  plain.WorkOther = plain.work_other;
  plain.ContactPoint = plain.contact_point;
  plain.MetalTryIn = plain.metal_try_in;
  plain.UnglazedTryIn = plain.unglazed_try_in;
  plain.Enclosures = enclosures;
  plain.SignatureName = plain.signature_name;
  return plain;
}

// Utility to calculate Due Date & Pace
function calculateTimeline(startDateStr, daysAllowed, explicitDueDateStr, status) {
  let startDate = startDateStr ? new Date(startDateStr) : new Date();
  let days = parseInt(daysAllowed || 0, 10);
  
  let dueDate = explicitDueDateStr ? new Date(explicitDueDateStr) : null;
  if (!dueDate && days > 0) {
    dueDate = new Date(startDate);
    dueDate.setDate(dueDate.getDate() + days);
  }

  let paceStatus = 'On Time';
  let daysEarlyLate = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (dueDate && (status !== 'Completed')) {
    const dueTime = new Date(dueDate);
    dueTime.setHours(0, 0, 0, 0);
    const diffTime = today - dueTime;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      paceStatus = 'Delayed';
      daysEarlyLate = diffDays;
    }
  }

  return {
    dueDate: dueDate ? dueDate.toISOString().split('T')[0] : null,
    paceStatus,
    daysEarlyLate
  };
}

// Server-side stored Kanban Column Configuration for cross-device sync
const defaultKanbanCols = [
  { id: 'col_not_started', status: 'Not Started', title: 'Not Started', color: '#64748b', dotColor: '#94a3b8', isDefault: true },
  { id: 'col_in_progress', status: 'In Progress', title: 'In Progress', color: '#2563eb', dotColor: '#3b82f6', isDefault: true },
  { id: 'col_in_review', status: 'In Review', title: 'In Review', color: '#7c3aed', dotColor: '#8b5cf6', isDefault: true },
  { id: 'col_done', status: 'Completed', title: 'Done', color: '#16a34a', dotColor: '#22c55e', isDefault: true }
];

// Per-company Kanban column store (keyed by company identifier to ensure tenant isolation)
const kanbanColumnsByCompany = new Map();

// Derive a stable company key from the authenticated user
const getCompanyKey = (user) => {
  // SuperAdmin/Founder has their own global view; everyone else is scoped by business_entities
  if (['SuperAdmin', 'Founder'].includes(user.role)) {
    return `superadmin:${user.user_id}`;
  }
  // Use business_entities as the company discriminator (set at user creation time)
  const biz = user.business_entities || user.approved_by || user.user_id;
  return `company:${biz}`;
};

const blockClientModifications = (req, res, next) => {
  if (req.user && req.user.role === 'Client' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
     if (req.method === 'POST' && String(req.path || '').match(/\/comments$/)) {
       return next();
     }
     const path = String(req.path || '');
     const isTaskCreate = req.method === 'POST' && (path === '/' || path === '/api/tasks' || path.endsWith('/tasks'));
     if (isTaskCreate && req.body && (req.body.CaseType || req.body.PatientName || (Array.isArray(req.body.WorkTypes) && req.body.WorkTypes.length))) {
       return next();
     }
     return res.status(403).json({ success: false, error: 'Clients cannot modify tasks.' });
  }
  next();
};

// GET /api/tasks/kanban-columns — Fetch active Kanban Columns (scoped per company)
router.get('/kanban-columns', [authMiddleware, blockClientModifications], async (req, res) => {
  try {
    const key = getCompanyKey(req.user);
    const cols = kanbanColumnsByCompany.get(key) || defaultKanbanCols;
    return res.json({ success: true, columns: cols });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tasks/kanban-columns — Save active Kanban Columns (scoped per company)
router.post('/kanban-columns', [authMiddleware, blockClientModifications], async (req, res) => {
  try {
    const { columns } = req.body;
    if (Array.isArray(columns)) {
      const key = getCompanyKey(req.user);
      kanbanColumnsByCompany.set(key, columns);
    }
    const key = getCompanyKey(req.user);
    return res.json({ success: true, columns: kanbanColumnsByCompany.get(key) || defaultKanbanCols });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 1. Get List of Tasks (scoped by department / business / search)
router.get('/', [authMiddleware, blockClientModifications], async (req, res) => {
  try {
    const { department, businessEntity, status, search, myTasksOnly } = req.query;
    const isSuper = ['SuperAdmin', 'Founder'].includes(req.user.role);

    let tasks;

    // ── myTasksOnly mode: Return ONLY tasks assigned to the current user (all roles) ──
    if (myTasksOnly === 'true') {
      if (req.user.role === 'Client') {
        return res.json({ success: true, data: [] });
      }
      
      const uid = String(req.user.user_id || '');
      const uemail = (req.user.email || '').toLowerCase();
      const ufullname = (req.user.full_name || req.user.name || '').toLowerCase();

      const myConditions = [
        { assigned_to: uid },
        { assigned_to: { [Op.like]: `%${uid}%` } },
        { created_by: uid },
        ...(uemail ? [
          { assigned_to: uemail },
          { assigned_to: { [Op.like]: `%${uemail}%` } },
          { created_by: uemail }
        ] : []),
        ...(ufullname ? [
          { assigned_to: { [Op.like]: `%${ufullname}%` } }
        ] : [])
      ];

      const myWhereClause = {
        [Op.or]: myConditions,
        [Op.and]: [
          { task_id: { [Op.notLike]: 'TSK_AP_MAIN_%' } },
          {
            [Op.or]: [
              { description: null },
              { description: '' },
              { description: { [Op.notLike]: '%[AP_MAIN:%' } }
            ]
          }
        ]
      };

      if (status) myWhereClause.status = status;

      if (businessEntity && businessEntity !== 'ALL' && businessEntity.toLowerCase() !== 'all') {
        myWhereClause[Op.and].push({
          [Op.or]: [
            { business_entity: businessEntity },
            { business_entity: { [Op.like]: `%${businessEntity}%` } },
            { business_entity: 'Company X (Shared)' },
            { business_entity: null },
            { business_entity: '' }
          ]
        });
      }

      const myTasksList = await Task.findAll({
        where: myWhereClause,
        include: [{ model: Task, as: 'Subtasks' }],
        order: [['created_at', 'DESC']]
      });

      // Format and return
      const allUsers = await User.findAll({ attributes: ['user_id', 'email', 'full_name'] });
      const userMap = {};
      allUsers.forEach(u => {
        userMap[u.user_id] = u.full_name || u.email;
        if (u.email) userMap[u.email] = u.full_name || u.email;
      });

      const resolveAssignees = (str) => {
        if (!str) return 'Unassigned';
        return String(str).split(',').map(s => userMap[s.trim()] || s.trim()).join(', ');
      };

      const formattedMyTasks = myTasksList.map(t => {
        const plain = t.toJSON ? t.toJSON() : { ...t };
        plain.AssignedTo = plain.assigned_to;
        plain.AssigneeName = resolveAssignees(plain.assigned_to);
        if (Array.isArray(plain.Subtasks)) {
          plain.Subtasks = plain.Subtasks.map(st => ({
            ...st,
            AssignedTo: st.assigned_to,
            AssigneeName: resolveAssignees(st.assigned_to)
          }));
        }
        return plain;
      });

      return res.json({ success: true, data: formattedMyTasks });
    }

    const applyBusinessFilter = (wc) => {
      if (businessEntity && businessEntity !== 'ALL' && businessEntity.toLowerCase() !== 'all') {
        wc[Op.and] = [
          ...(wc[Op.and] || []),
          {
            [Op.or]: [
              { business_entity: businessEntity },
              { business_entity: { [Op.like]: `%${businessEntity}%` } },
              { business_entity: 'Company X (Shared)' },
              { business_entity: null },
              { business_entity: '' }
            ]
          }
        ];
      }
    };

    const applyApExclusions = (wc) => {
      wc[Op.and] = [
        ...(wc[Op.and] || []),
        {
          task_id: { [Op.notLike]: 'TSK_AP_MAIN_%' }
        },
        {
          [Op.or]: [
            { description: null },
            { description: '' },
            { description: { [Op.notLike]: '%[AP_MAIN:%' } }
          ]
        }
      ];
    };

    if (req.user.role === 'Client') {
      let allowedProjectIds = [];
      try {
        allowedProjectIds = req.user.client_project_ids ? JSON.parse(req.user.client_project_ids) : [];
      } catch(e) {}

      const whereClause = {
        [Op.or]: [
          { created_by: req.user.user_id },
          { created_by: req.user.email },
          ...(allowedProjectIds.length ? [{ project_id: { [Op.in]: allowedProjectIds } }] : [])
        ]
      };
      applyApExclusions(whereClause);
      if (status) whereClause.status = status;
      if (search) {
        whereClause[Op.and] = [
          ...(whereClause[Op.and] || []),
          {
            [Op.or]: [
              { title: { [Op.like]: `%${search}%` } },
              { description: { [Op.like]: `%${search}%` } }
            ]
          }
        ];
      }

      tasks = await Task.findAll({
        where: whereClause,
        include: [{ model: Task, as: 'Subtasks' }],
        order: [['created_at', 'DESC']]
      });

    } else if (isSuper) {
      // SuperAdmin / Founder sees everything
      const whereClause = {};
      if (department && department !== 'ALL' && department.toLowerCase() !== 'all') {
        whereClause[Op.or] = [
          { department: department },
          { department: { [Op.like]: `%${department}%` } }
        ];
      }
      applyBusinessFilter(whereClause);
      applyApExclusions(whereClause);
      if (status) whereClause.status = status;
      if (search) {
        whereClause[Op.or] = [
          { title: { [Op.like]: `%${search}%` } },
          { description: { [Op.like]: `%${search}%` } }
        ];
      }
      tasks = await Task.findAll({
        where: whereClause,
        include: [{ model: Task, as: 'Subtasks' }],
        order: [['created_at', 'DESC']]
      });

    } else if (req.user.role === 'TeamMember') {
      // Employee: Tasks assigned to them or created by them (by user_id, email, or full_name)
      const uid = String(req.user.user_id || '');
      const uemail = req.user.email || '';
      const ufullname = req.user.full_name || req.user.name || '';

      const assignConditions = [
        { created_by: uid },
        { assigned_to: uid },
        { assigned_to: { [Op.like]: `%${uid}%` } },
        ...(uemail ? [
          { created_by: uemail },
          { assigned_to: uemail },
          { assigned_to: { [Op.like]: `%${uemail}%` } }
        ] : []),
        ...(ufullname ? [
          { assigned_to: ufullname },
          { assigned_to: { [Op.like]: `%${ufullname}%` } }
        ] : [])
      ];

      const whereClause = {
        [Op.or]: assignConditions
      };
      applyBusinessFilter(whereClause);
      applyApExclusions(whereClause);
      if (status) whereClause.status = status;
      if (search) {
        whereClause[Op.and] = [
          ...(whereClause[Op.and] || []),
          {
            [Op.or]: [
              { title: { [Op.like]: `%${search}%` } },
              { description: { [Op.like]: `%${search}%` } }
            ]
          }
        ];
      }

      tasks = await Task.findAll({
        where: whereClause,
        include: [{ model: Task, as: 'Subtasks' }],
        order: [['created_at', 'DESC']]
      });

    } else if (req.user.role === 'DeptAdmin') {
      // Dept Head: Tasks in their department OR assigned to them OR created by them
      const userDept = req.user.department || 'Operations';
      const depts = userDept.split(',').map(s => s.trim()).filter(Boolean);

      const uid = String(req.user.user_id || '');
      const uemail = req.user.email || '';
      const ufullname = req.user.full_name || req.user.name || '';

      const deptOrConditions = depts.map(d => ({
        department: { [Op.like]: `%${d}%` }
      }));

      const assignConditions = [
        { created_by: uid },
        { assigned_to: uid },
        { assigned_to: { [Op.like]: `%${uid}%` } },
        ...(uemail ? [
          { created_by: uemail },
          { assigned_to: uemail },
          { assigned_to: { [Op.like]: `%${uemail}%` } }
        ] : []),
        ...(ufullname ? [
          { assigned_to: ufullname },
          { assigned_to: { [Op.like]: `%${ufullname}%` } }
        ] : [])
      ];

      const whereClause = {
        [Op.or]: [
          ...deptOrConditions,
          ...assignConditions
        ]
      };
      applyBusinessFilter(whereClause);
      applyApExclusions(whereClause);
      if (status) whereClause.status = status;
      if (search) {
        whereClause[Op.and] = [
          ...(whereClause[Op.and] || []),
          {
            [Op.or]: [
              { title: { [Op.like]: `%${search}%` } },
              { description: { [Op.like]: `%${search}%` } }
            ]
          }
        ];
      }

      tasks = await Task.findAll({
        where: whereClause,
        include: [{ model: Task, as: 'Subtasks' }],
        order: [['created_at', 'DESC']]
      });

    } else {
      // Admin: All Admins & members of the same organization see all tasks belonging to that organization
      const adminUserId = req.user.user_id;
      const userBizStr = req.user.business_entities || '';
      const userBizs = userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      // Find all users in the same organization
      const allUsers = await User.findAll({ attributes: ['user_id', 'email', 'business_entities', 'approved_by'] });
      const sameOrgUsers = allUsers.filter(u => {
        if (u.user_id === adminUserId || u.email === req.user.email) return true;
        if (u.approved_by === adminUserId || u.approved_by === req.user.email) return true;
        const uBizs = (u.business_entities || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        return userBizs.length > 0 && userBizs.some(b => uBizs.includes(b));
      });
      const sameOrgUserIds = [adminUserId, ...sameOrgUsers.map(u => u.user_id)];
      const sameOrgEmails = [req.user.email, ...sameOrgUsers.map(u => u.email).filter(Boolean)];

      const adminOrConditions = [
        { created_by: { [Op.in]: [...sameOrgUserIds, ...sameOrgEmails] } },
        { assigned_to: { [Op.in]: sameOrgUserIds } }
      ];
      sameOrgUserIds.forEach(id => {
        if (id) adminOrConditions.push({ assigned_to: { [Op.like]: `%${id}%` } });
      });
      sameOrgEmails.forEach(em => {
        if (em) adminOrConditions.push({ assigned_to: { [Op.like]: `%${em}%` } });
      });
      userBizs.forEach(b => {
        adminOrConditions.push({ business_entity: b });
        adminOrConditions.push({ business_entity: { [Op.like]: `%${b}%` } });
      });

      const whereClause = {
        [Op.or]: adminOrConditions
      };

      if (department && department !== 'ALL' && department.toLowerCase() !== 'all') {
        whereClause[Op.and] = [
          ...(whereClause[Op.and] || []),
          {
            [Op.or]: [
              { department: department },
              { department: { [Op.like]: `%${department}%` } }
            ]
          }
        ];
      }
      applyBusinessFilter(whereClause);
      applyApExclusions(whereClause);
      if (status) whereClause.status = status;
      if (search) {
        whereClause[Op.and] = [
          ...(whereClause[Op.and] || []),
          {
            [Op.or]: [
              { title: { [Op.like]: `%${search}%` } },
              { description: { [Op.like]: `%${search}%` } }
            ]
          }
        ];
      }

      tasks = await Task.findAll({
        where: whereClause,
        include: [{ model: Task, as: 'Subtasks' }],
        order: [['created_at', 'DESC']]
      });
    }

    // Lab cases must appear for staff even if they sit outside the company filter.
    // Pending cases feed Lab Approvals; approved cases must land on the kanban board.
    if (req.user.role !== 'Client') {
      const labCases = await Task.findAll({
        where: {
          approval_status: { [Op.in]: ['pending', 'approved'] },
          [Op.or]: [
            { case_type: { [Op.ne]: null } },
            { patient_name: { [Op.ne]: null } }
          ]
        },
        include: [{ model: Task, as: 'Subtasks' }],
        order: [['created_at', 'DESC']]
      });
      const seen = new Set((tasks || []).map((t) => t.task_id));
      tasks = [...(tasks || [])];
      labCases.forEach((t) => {
        if (!seen.has(t.task_id)) tasks.push(t);
      });
    }

    // Populate user names for assignees
    const users = await User.findAll({ attributes: ['user_id', 'full_name', 'email'] });
    const userMap = {};
    users.forEach(u => { 
      userMap[u.user_id] = u.full_name || u.email;
      if (u.email) userMap[u.email] = u.full_name || u.email;
    });

    const resolveAssignees = (rawStr) => {
      if (!rawStr) return 'Unassigned';
      const items = String(rawStr).split(',').map(s => s.trim()).filter(Boolean);
      const names = items.map(item => userMap[item] || item);
      return names.length > 0 ? names.join(', ') : 'Unassigned';
    };

    const formattedTasks = tasks.map(t => {
      const plain = t.get({ plain: true });
      plain.TaskID = plain.task_id;
      plain.ParentTaskID = plain.parent_task_id;
      plain.Title = plain.title;
      plain.Description = plain.description;
      plain.MainHeading = plain.main_heading;
      plain.BusinessEntity = plain.business_entity;
      plain.Department = plain.department;
      plain.Priority = plain.priority;
      plain.AssignedTo = plain.assigned_to;
      plain.AssigneeName = resolveAssignees(plain.assigned_to);
      plain.AssignedBy = plain.assigned_by;
      plain.DocumentLinks = plain.document_links;
      plain.StartDate = plain.start_date;
      plain.DaysAllowed = plain.days_allowed;
      plain.DueDate = plain.due_date;
      plain.CompletionDate = plain.completion_date;
      plain.PaceStatus = plain.pace_status;
      plain.DaysEarlyLate = plain.days_early_late;
      plain.Status = plain.status;
      plain.EstimatedBudget = plain.estimated_budget;
      plain.ActualExpense = plain.actual_expense;
      plain.Remarks = plain.remarks;
      plain.StoryPoints = parseFloat(plain.story_points) || 0;
      plain.ProjectID = plain.project_id;
      attachLabFields(plain);
      plain.is_subtask = !!plain.parent_task_id || (plain.description && (plain.description.includes('[AP:') || plain.description.startsWith('Sub-task of:')));
      plain.IsSubtask = plain.is_subtask;

      if (plain.Subtasks) {
        plain.Subtasks = plain.Subtasks.map(st => ({
          ...st,
          TaskID: st.task_id,
          Title: st.title,
          Department: st.department,
          Status: st.status,
          StoryPoints: parseFloat(st.story_points) || 0,
          AssigneeName: resolveAssignees(st.assigned_to)
        }));
      }

      return plain;
    });

    return res.json({ success: true, data: formattedTasks });
  } catch (err) {
    console.error('Fetch tasks error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get Single Task Details
router.get('/:taskId', [authMiddleware, blockClientModifications], async (req, res) => {
  try {
    const task = await Task.findOne({
      where: { task_id: req.params.taskId },
      include: [{ model: Task, as: 'Subtasks' }]
    });
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const users = await User.findAll({ attributes: ['user_id', 'full_name', 'email'] });
    const userMap = {};
    users.forEach(u => { userMap[u.user_id] = u.full_name || u.email; });

    const plain = task.get({ plain: true });
    plain.TaskID = plain.task_id;
    plain.ParentTaskID = plain.parent_task_id;
    plain.Title = plain.title;
    plain.Description = plain.description;
    plain.MainHeading = plain.main_heading;
    plain.BusinessEntity = plain.business_entity;
    plain.Department = plain.department;
    plain.Priority = plain.priority;
    plain.AssignedTo = plain.assigned_to;
    plain.AssigneeName = userMap[plain.assigned_to] || plain.assigned_to || 'Unassigned';
    plain.AssignedBy = plain.assigned_by;
    plain.DocumentLinks = plain.document_links;
    plain.StartDate = plain.start_date;
    plain.DaysAllowed = plain.days_allowed;
    plain.DueDate = plain.due_date;
    plain.CompletionDate = plain.completion_date;
    plain.PaceStatus = plain.pace_status;
    plain.DaysEarlyLate = plain.days_early_late;
    plain.Status = plain.status;
    plain.EstimatedBudget = plain.estimated_budget;
    plain.ActualExpense = plain.actual_expense;
    plain.Remarks = plain.remarks;
    plain.StoryPoints = parseFloat(plain.story_points) || 0;
    plain.ProjectID = plain.project_id;
    attachLabFields(plain);
    plain.is_subtask = !!plain.parent_task_id || (plain.description && (plain.description.includes('[AP:') || plain.description.startsWith('Sub-task of:')));
    plain.IsSubtask = plain.is_subtask;

    if (plain.Subtasks) {
      plain.Subtasks = plain.Subtasks.map(st => ({
        ...st,
        TaskID: st.task_id,
        Title: st.title,
        Department: st.department,
        Status: st.status,
        StoryPoints: parseFloat(st.story_points) || 0,
        AssigneeName: userMap[st.assigned_to] || st.assigned_to || 'Unassigned'
      }));
    }

    return res.json({ success: true, data: plain });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Create Main Task & Linked Sub-Tasks
router.post('/', [authMiddleware, blockClientModifications], async (req, res) => {
  try {
    const data = req.body;
    const taskId = 'TSK_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    const timeline = calculateTimeline(data.StartDate || data.FormDate, data.DaysAllowed, data.RequestedDueDate || data.DeliveryDate || data.DueDate, 'Not Started');

    let initialStoryPoints = parseFloat(data.StoryPoints) || 0;
    const hasSubtasks = data.Subtasks && Array.isArray(data.Subtasks) && data.Subtasks.length > 0;
    if (hasSubtasks) {
      initialStoryPoints = data.Subtasks.reduce((sum, st) => {
        const spVal = parseFloat(st.StoryPoints || st.storyPoints || st.story_points) || 0;
        return sum + spVal;
      }, 0);
    }

    const userFirstBiz = req.user?.business_entities ? req.user.business_entities.split(',')[0].trim() : '';
    const finalBiz = (data.BusinessEntity && data.BusinessEntity !== 'Company X (Shared)')
      ? data.BusinessEntity
      : (userFirstBiz || 'General');

    const validMainHeading = ['Documentation', 'Operations', 'Marketing', 'Revenue', 'Tech'].includes(data.MainHeading)
      ? data.MainHeading
      : 'Operations';

    const workTypes = Array.isArray(data.WorkTypes) ? data.WorkTypes.filter(Boolean) : [];
    const enclosures = Array.isArray(data.Enclosures) ? data.Enclosures.filter(Boolean) : [];
    const caseType = primaryCaseType(workTypes, data.CaseType);
    const submittedByClient = req.user.role === 'Client';
    const isLabCase = Boolean(caseType || data.PatientName || submittedByClient);

    if (submittedByClient && !isLabCase) {
      return res.status(403).json({ success: false, error: 'Clients can only submit lab cases' });
    }

    const newTask = await Task.create({
      task_id: taskId,
      parent_task_id: data.ParentTaskID || null,
      main_heading: validMainHeading,
      title: data.Title || (data.PatientName ? `${data.PatientName} ${data.ToothNumbers || ''}`.trim() : 'Lab case'),
      description: data.Description || '',
      business_entity: finalBiz,
      department: data.Department || req.user.department || 'Operations',
      priority: data.Priority || 'Normal',
      assigned_to: data.AssignedTo || null,
      assigned_by: req.user.full_name || req.user.name || req.user.email,
      document_links: data.DocumentLinks || '',
      start_date: data.StartDate || data.FormDate || new Date().toISOString().split('T')[0],
      days_allowed: data.DaysAllowed || 0,
      due_date: data.RequestedDueDate || data.DeliveryDate || timeline.dueDate,
      pace_status: timeline.paceStatus,
      days_early_late: timeline.daysEarlyLate,
      status: 'Not Started',
      estimated_budget: data.EstimatedBudget || 0,
      actual_expense: 0,
      remarks: data.Remarks || '',
      story_points: initialStoryPoints,
      project_id: data.ProjectID || data.project_id || null,
      created_by: req.user.user_id,
      case_type: caseType,
      patient_name: data.PatientName || null,
      tooth_numbers: data.ToothNumbers || null,
      shade: data.Shade || null,
      approval_status: isLabCase ? (submittedByClient ? 'pending' : 'approved') : null,
      lab_stage: 0,
      form_date: data.FormDate || new Date().toISOString().split('T')[0],
      doctor_name: data.DoctorName || null,
      hospital_name: data.HospitalName || null,
      patient_age: data.PatientAge || data.Age || null,
      patient_sex: data.PatientSex || data.Sex || null,
      work_types: stringifyJsonField(workTypes),
      work_other: data.WorkOther || null,
      contact_point: data.ContactPoint || null,
      metal_try_in: data.MetalTryIn || null,
      unglazed_try_in: data.UnglazedTryIn || null,
      enclosures: stringifyJsonField(enclosures),
      signature_name: data.SignatureName || (submittedByClient ? (req.user.full_name || req.user.email) : null)
    });

    // Send Telegram Notification for Main Task
    try {
      await sendTelegramTaskAssignment(newTask, null, req.user);
    } catch (telErr) {
      console.error('[Telegram] Main task notification error:', telErr.message);
    }

    // Create Initial Linked Sub-Tasks if provided
    if (hasSubtasks) {
      for (const st of data.Subtasks) {
        const subTitle = (st.Title || st.title || '').trim();
        if (subTitle) {
          const subtaskId = 'TSK_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          const subAssigneeStr = Array.isArray(st.AssignedTo)
            ? st.AssignedTo.join(', ')
            : (Array.isArray(st.assignedTo)
              ? st.assignedTo.join(', ')
              : (st.AssignedTo || st.assignedTo || st.assigned_to || null));
          const subDept = st.Department || st.department || newTask.department;
          const subSP = parseFloat(st.StoryPoints || st.storyPoints || st.story_points) || 0;
          const subPriority = st.Priority || st.priority || newTask.priority || 'Normal';

          const subtask = await Task.create({
            task_id: subtaskId,
            parent_task_id: taskId,
            main_heading: validMainHeading,
            title: subTitle,
            description: st.Description || st.description || `Sub-task of: ${newTask.title}`,
            business_entity: newTask.business_entity,
            department: subDept,
            priority: subPriority,
            assigned_to: subAssigneeStr || null,
            assigned_by: req.user.full_name || req.user.name || req.user.email,
            start_date: st.StartDate || st.start_date || newTask.start_date,
            due_date: st.DueDate || st.due_date || newTask.due_date,
            status: st.Status || st.status || 'Not Started',
            story_points: subSP,
            project_id: newTask.project_id || null,
            created_by: req.user.user_id
          });

          // Dispatch Telegram Notification for each Subtask!
          try {
            
          // --- Audit Log: created subtask ---
          await AuditLog.create({
            log_id: 'LOG_' + Date.now() + '_' + Math.random().toString(36).substr(2,5),
            user_id: req.user ? req.user.UserID || req.user.user_id : 'system',
            action: 'created',
            entity_type: 'Task',
            entity_id: subtask.task_id,
            details: 'Subtask created',
            business_entity: newTask.business_entity || ''
          });

            await sendTelegramTaskAssignment(subtask, null, req.user);
          } catch (subTelErr) {
            console.error('[Telegram] Subtask notification error:', subTelErr.message);
          }
        }
      }
    }

    
    // --- Audit Log: created main task ---
    await AuditLog.create({
      log_id: 'LOG_' + Date.now() + '_' + Math.random().toString(36).substr(2,5),
      user_id: req.user ? req.user.UserID || req.user.user_id : 'system',
      action: 'created',
      entity_type: 'Task',
      entity_id: newTask.task_id,
      details: 'Task created',
      business_entity: newTask.business_entity || ''
    });

    return res.json({ success: true, data: newTask });
  } catch (err) {
    console.error('Create task error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Update Task & Add Extra Sub-tasks in Edit Mode

router.post('/:taskId/seen', [authMiddleware, blockClientModifications], async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await Task.findOne({ where: { task_id: taskId } });
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (!task.seen_at) {
      task.seen_at = new Date();
      await task.save();
      
      const logId = 'LOG_' + Date.now() + '_' + Math.random().toString(36).substr(2,5);
      await AuditLog.create({
        log_id: logId,
        user_id: req.user ? req.user.UserID : 'system',
        action: 'seen',
        entity_type: 'Task',
        entity_id: taskId,
        details: 'Task was viewed for the first time',
        business_entity: task.business_entity || ''
      });
    }

    res.json({ success: true, data: task });
  } catch (err) {
    console.error('Error marking task as seen:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.put('/:taskId/approve', [authMiddleware], async (req, res) => {
  try {
    if (!['Admin', 'DeptAdmin', 'SuperAdmin', 'Founder'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Only admins can approve lab cases' });
    }
    const task = await Task.findOne({ where: { task_id: req.params.taskId } });
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    const approverBiz = String(req.body.BusinessEntity || (req.user.business_entities || '').split(',')[0] || '').trim();
    const nextBiz = (!task.business_entity || task.business_entity === 'General') && approverBiz
      ? approverBiz
      : task.business_entity;
    await task.update({
      approval_status: 'approved',
      assigned_to: req.body.AssignedTo !== undefined ? req.body.AssignedTo : task.assigned_to,
      due_date: req.body.DueDate !== undefined ? req.body.DueDate : task.due_date,
      lab_stage: 0,
      status: 'Not Started',
      business_entity: nextBiz || task.business_entity,
      main_heading: task.main_heading || 'Operations'
    });
    return res.json({ success: true, data: task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:taskId/reject', [authMiddleware], async (req, res) => {
  try {
    if (!['Admin', 'DeptAdmin', 'SuperAdmin', 'Founder'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Only admins can reject lab cases' });
    }
    const task = await Task.findOne({ where: { task_id: req.params.taskId } });
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    await task.update({
      approval_status: 'rejected',
      rejection_reason: req.body.reason || 'Rejected',
      status: 'Completed'
    });
    return res.json({ success: true, data: task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:taskId', [authMiddleware, blockClientModifications], async (req, res) => {
  try {
    const { taskId } = req.params;
    const { updates } = req.body;

    console.log(`[PUT /api/tasks/${taskId}] Update received:`, JSON.stringify(updates));

    const task = await Task.findOne({ where: { task_id: taskId } });
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const newStatus = updates.Status !== undefined ? updates.Status : task.status;
    const timeline = calculateTimeline(
      updates.StartDate !== undefined ? updates.StartDate : task.start_date,
      updates.DaysAllowed !== undefined ? updates.DaysAllowed : task.days_allowed,
      updates.DueDate !== undefined ? updates.DueDate : task.due_date,
      newStatus
    );

    const updateFields = {};
    if (updates.MainHeading) updateFields.main_heading = updates.MainHeading;
    if (updates.Title) updateFields.title = updates.Title;
    if (updates.Description !== undefined) updateFields.description = updates.Description;
    if (updates.BusinessEntity) updateFields.business_entity = updates.BusinessEntity;
    if (updates.Department) updateFields.department = updates.Department;
    if (updates.Priority) updateFields.priority = updates.Priority;
    if (updates.AssignedTo !== undefined) updateFields.assigned_to = updates.AssignedTo;
    if (updates.AssignedBy) updateFields.assigned_by = updates.AssignedBy;
    if (updates.DocumentLinks !== undefined) updateFields.document_links = updates.DocumentLinks;
    if (updates.StartDate) updateFields.start_date = updates.StartDate;
    if (updates.DaysAllowed !== undefined) updateFields.days_allowed = updates.DaysAllowed;
    if (updates.DueDate !== undefined) updateFields.due_date = updates.DueDate || timeline.dueDate;
    if (updates.ProjectID !== undefined) updateFields.project_id = updates.ProjectID;
    if (updates.project_id !== undefined) updateFields.project_id = updates.project_id;
    if (updates.EstimatedBudget !== undefined) updateFields.estimated_budget = updates.EstimatedBudget;
    if (updates.ActualExpense !== undefined) updateFields.actual_expense = updates.ActualExpense;
    if (updates.Remarks !== undefined) updateFields.remarks = updates.Remarks;
    if (updates.StoryPoints !== undefined) updateFields.story_points = parseFloat(updates.StoryPoints) || 0;
    if (updates.LabStage !== undefined) {
      updateFields.lab_stage = parseInt(updates.LabStage, 10) || 0;
      const names = stagesFor(task.case_type);
      if (names && updates.Status === undefined) {
        if (updateFields.lab_stage <= 0) updateFields.status = 'Not Started';
        else updateFields.status = 'In Progress';
      }
    }
    if (updates.Status) updateFields.status = updates.Status;

    updateFields.pace_status = timeline.paceStatus;
    updateFields.days_early_late = timeline.daysEarlyLate;

    if (newStatus === 'Completed' && !task.completion_date) {
      updateFields.completion_date = new Date().toISOString().split('T')[0];
    }

        const oldStatus = task.status;
    const oldAssignedTo = task.assigned_to;
    await task.update(updateFields);

    // --- Audit Log: Status or Assignment changes ---
    const logUserId = req.user ? req.user.UserID || req.user.user_id : 'system';
    
    if (updates.AssignedTo !== undefined && updates.AssignedTo !== oldAssignedTo) {
      await AuditLog.create({
        log_id: 'LOG_' + Date.now() + '_' + Math.random().toString(36).substr(2,5),
        user_id: logUserId,
        action: 'assigned',
        entity_type: 'Task',
        entity_id: taskId,
        details: `Assigned to ${updates.AssignedTo || 'Unassigned'}`,
        business_entity: task.business_entity || ''
      });
    }

    if (updates.Status !== undefined && updates.Status !== oldStatus) {
      let actionType = 'status_change';
      const now = new Date();
      
      if (updates.Status === 'In Progress') {
        actionType = 'working';
        await task.update({ working_at: now });
      } else if (updates.Status === 'In Review' || updates.Status === 'Done') {
        actionType = 'done';
        await task.update({ done_at: now });
      } else if (updates.Status === 'Completed') {
        actionType = 'closed';
        await task.update({ closed_at: now });
      }

      await AuditLog.create({
        log_id: 'LOG_' + Date.now() + '_' + Math.random().toString(36).substr(2,5),
        user_id: logUserId,
        action: actionType,
        entity_type: 'Task',
        entity_id: taskId,
        details: `Status changed to ${updates.Status}`,
        business_entity: task.business_entity || ''
      });

      if (task.project_id) {
        const clientMsg = 
          `🚀 <b>Task Status Updated</b>\n` +
          `👤 <b>By:</b> ${req.user.full_name || req.user.email}\n` +
          `📌 <b>Task:</b> ${task.title}\n` +
          `🔄 <b>New Status:</b> ${updates.Status}`;
        await forwardToClientChatroom(task.project_id, clientMsg);
      }
    }


    // Sync task completion status back to Action Plan structure
    const syncTaskToActionPlan = async (taskRecord, currentStatus) => {
      try {
        const { ActionPlan } = require('../models');
        if (!taskRecord) return;

        const isDone = ['completed', 'done', 'complete'].includes(String(currentStatus || '').trim().toLowerCase());
        
        const cleanStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const taskTitleLower = String(taskRecord.title || '').trim().toLowerCase();
        const taskClean = cleanStr(taskRecord.title);

        // Check if task description contains [AP:planId:apTaskId] tag
        const apMatch = taskRecord.description ? String(taskRecord.description).match(/\[AP:([^:]+):([^\]]+)\]/) : null;
        const targetPlanId = apMatch ? apMatch[1] : null;
        const targetApTaskId = apMatch ? apMatch[2] : null;

        let plans = [];
        if (targetPlanId) {
          const singlePlan = await ActionPlan.findOne({ where: { plan_id: targetPlanId } });
          if (singlePlan) plans = [singlePlan];
        }
        if (plans.length === 0) {
          plans = await ActionPlan.findAll();
        }

        for (const plan of plans) {
          let currentStructure = plan.structure;
          if (typeof currentStructure === 'string') {
            try { currentStructure = JSON.parse(currentStructure); } catch (e) { currentStructure = []; }
          }
          if (!Array.isArray(currentStructure)) continue;

          let planUpdated = false;
          const newStructure = currentStructure.map(pillar => ({
            ...pillar,
            subheadings: (pillar.subheadings || []).map(sub => ({
              ...sub,
              tasks: (sub.tasks || []).map(t => {
                const tTitleLower = String(t.title || '').trim().toLowerCase();
                const tClean = cleanStr(t.title);

                const matchesId = targetApTaskId && String(t.id) === String(targetApTaskId);
                const matchesExact = tTitleLower && (tTitleLower === taskTitleLower);
                const matchesClean = tClean && taskClean && (tClean === taskClean || tClean.includes(taskClean) || taskClean.includes(tClean));

                if (matchesId || matchesExact || matchesClean) {
                  planUpdated = true;
                  return { ...t, completed: isDone };
                }
                return t;
              })
            }))
          }));

          if (planUpdated) {
            plan.structure = newStructure;
            plan.changed('structure', true);
            await plan.save();
            console.log(`[ActionPlan Sync] ✅ Synced Task "${taskRecord.title}" status "${currentStatus}" to Action Plan "${plan.title}" (completed=${isDone})`);
          }
        }
      } catch (err) {
        console.error('Error syncing task status to Action Plan:', err);
      }
    };

    if (updates.Status !== undefined || newStatus) {
      await syncTaskToActionPlan(task, newStatus);
    }

    // Send Telegram alert on task assignment or update
    if (updates.AssignedTo !== undefined || updates.Status !== undefined) {
      try {
        await sendTelegramTaskAssignment(task, null, req.user);
      } catch (telErr) {
        console.error('[Telegram] Task update notification error:', telErr.message);
      }
    }

    // Handle adding Extra Sub-Tasks in Section 4 of Edit Task Modal
    const rawExtraSubtasks = req.body.extraSubtasks || (updates && (updates.extraSubtasks || updates.newSubtasks));
    if (rawExtraSubtasks && Array.isArray(rawExtraSubtasks) && rawExtraSubtasks.length > 0) {
      for (const st of rawExtraSubtasks) {
        const subTitle = (st.Title || st.title || '').trim();
        if (subTitle) {
          const extraSubId = 'TSK_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          const subAssigneeStr = Array.isArray(st.AssignedTo)
            ? st.AssignedTo.join(', ')
            : (Array.isArray(st.assignedTo)
              ? st.assignedTo.join(', ')
              : (st.AssignedTo || st.assignedTo || st.assigned_to || null));
          const subDept = st.Department || st.department || task.department;
          const subSP = parseFloat(st.StoryPoints || st.storyPoints || st.story_points) || 0;
          const subPriority = st.Priority || st.priority || task.priority || 'Normal';

          const extraSub = await Task.create({
            task_id: extraSubId,
            parent_task_id: task.task_id,
            main_heading: task.main_heading || 'Operations',
            title: subTitle,
            description: st.Description || st.description || `Sub-task of: ${task.title}`,
            business_entity: task.business_entity,
            department: subDept,
            priority: subPriority,
            assigned_to: subAssigneeStr || null,
            assigned_by: req.user.full_name || req.user.name || req.user.email,
            start_date: st.StartDate || st.start_date || task.start_date,
            due_date: st.DueDate || st.due_date || task.due_date,
            status: st.Status || st.status || 'Not Started',
            story_points: subSP,
            project_id: task.project_id || null,
            created_by: req.user.user_id
          });

          try {
            await sendTelegramTaskAssignment(extraSub, null, req.user);
          } catch (telErr) {
            console.error('[Telegram] Extra subtask alert error:', telErr.message);
          }
        }
      }

      // Recalculate Main Task Story Points from all sub-tasks
      const allSubtasks = await Task.findAll({ where: { parent_task_id: task.task_id } });
      const totalSP = allSubtasks.reduce((sum, s) => sum + (parseFloat(s.story_points) || 0), 0);
      await task.update({ story_points: totalSP });
    }

    // Auto-complete Main Task if ALL its sub-tasks are completed!
    const targetParentId = task.parent_task_id;
    if (targetParentId) {
      const siblingSubtasks = await Task.findAll({
        where: { parent_task_id: targetParentId }
      });

      const allSiblingsCompleted = siblingSubtasks.length > 0 && siblingSubtasks.every(s => s.status === 'Completed');
      if (allSiblingsCompleted) {
        const parentTask = await Task.findOne({ where: { task_id: targetParentId } });
        if (parentTask && parentTask.status !== 'Completed') {
          await parentTask.update({
            status: 'Completed',
            completion_date: new Date().toISOString().split('T')[0],
            pace_status: 'On Time'
          });
          console.log(`[Auto-Complete] Main Task ${targetParentId} automatically marked as Completed!`);
        }
      }

      // Recalculate parent task total story points
      const parentTaskToUpdate = await Task.findOne({ where: { task_id: targetParentId } });
      if (parentTaskToUpdate) {
        const parentSubtasks = await Task.findAll({ where: { parent_task_id: targetParentId } });
        const parentTotalSP = parentSubtasks.reduce((sum, s) => sum + (parseFloat(s.story_points) || 0), 0);
        await parentTaskToUpdate.update({ story_points: parentTotalSP });
      }
    }

    // Auto-Complete Main Parent Task if all sibling sub-tasks reach Completed status
    if (task.parent_task_id && (newStatus === 'Completed')) {
      const siblingSubtasks = await Task.findAll({ where: { parent_task_id: task.parent_task_id } });
      const allSiblingsDone = siblingSubtasks.every(st => st.status === 'Completed');

      if (allSiblingsDone) {
        const parentTask = await Task.findOne({ where: { task_id: task.parent_task_id } });
        if (parentTask) {
          await parentTask.update({
            status: 'Completed',
            completion_date: new Date().toISOString().split('T')[0],
            pace_status: 'On Time'
          });
          console.log(`[Auto-Completion] Main Task ${parentTask.task_id} auto-completed as all sub-tasks are done!`);
        }
      }
    }

    return res.json({ success: true, message: 'Task updated successfully' });
  } catch (err) {
    console.error('Update task error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
