const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { ActionPlan, Project, Task, User } = require('../models');

// 1. GET /api/action-plans - List action plans with account & company privacy
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { projectId, businessEntity } = req.query;
    const currentUser = req.user;
    const isSuper = ['SuperAdmin', 'Founder'].includes(currentUser.role);

    const whereClause = {};
    if (projectId) {
      whereClause.project_id = projectId;
    }

    let plans = await ActionPlan.findAll({
      where: whereClause,
      include: [{ model: Project, as: 'Project', attributes: ['project_id', 'title', 'created_by', 'business_entity', 'department'], required: false }],
      order: [['updated_at', 'DESC']]
    });

    if (businessEntity && businessEntity !== 'ALL' && businessEntity.toLowerCase() !== 'all') {
      plans = plans.filter(p => {
        if (!p.Project) return false;
        const pBiz = String(p.Project.business_entity || '').toLowerCase();
        const searchBiz = businessEntity.toLowerCase();
        return pBiz === searchBiz || pBiz.includes(searchBiz) || pBiz === 'company x (shared)';
      });
    }

    if (!isSuper) {
      const uIdLower = String(currentUser.user_id || '').trim().toLowerCase();
      const uEmailLower = String(currentUser.email || '').trim().toLowerCase();
      const ownAdminId = String(currentUser.approved_by || '').trim().toLowerCase();

      const userBizStr = currentUser.business_entities || '';
      const userBizs = userBizStr ? userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

      // Identify the Owner (Admin) for this user's organization
      let orgAdminId = String(currentUser.user_id || '').trim().toLowerCase();
      let orgAdminEmail = String(currentUser.email || '').trim().toLowerCase();
      
      if (currentUser.role !== 'Admin' && currentUser.approved_by) {
        orgAdminId = String(currentUser.approved_by || '').trim().toLowerCase();
      }

      // Find all users who belong to the SAME organization as currentUser
      const allUsers = await User.findAll({ attributes: ['user_id', 'email', 'business_entities', 'approved_by'] });
      const sameOrgUsers = allUsers.filter(u => {
        const uid = String(u.user_id || '').trim().toLowerCase();
        const uemail = String(u.email || '').trim().toLowerCase();
        const uapp = String(u.approved_by || '').trim().toLowerCase();

        if (uid === orgAdminId || uemail === orgAdminId || uapp === orgAdminId || uid === orgAdminEmail || uemail === orgAdminEmail || uapp === orgAdminEmail) {
          return true;
        }

        const uBizs = (u.business_entities || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        return userBizs.length > 0 && userBizs.some(b => uBizs.includes(b));
      });
      const sameOrgUserIds = [orgAdminId, ...sameOrgUsers.map(u => String(u.user_id || '').toLowerCase())];
      const sameOrgEmails = [orgAdminEmail, ...sameOrgUsers.map(u => String(u.email || '').toLowerCase())].filter(Boolean);

      plans = plans.filter(plan => {
        const planCreatedBy = String(plan.created_by || '').trim().toLowerCase();
        
        if (!planCreatedBy || sameOrgUserIds.includes(planCreatedBy) || sameOrgEmails.includes(planCreatedBy)) {
          return true;
        }

        const proj = plan.Project;
        if (proj) {
          const projCreatedBy = String(proj.created_by || '').trim().toLowerCase();
          if (projCreatedBy && (sameOrgUserIds.includes(projCreatedBy) || sameOrgEmails.includes(projCreatedBy))) {
            return true;
          }

          const projBiz = String(proj.business_entity || '').trim().toLowerCase();
          if (userBizs.length > 0 && projBiz && userBizs.some(b => b === projBiz || projBiz.includes(b) || b.includes(projBiz))) {
            return true;
          }
        }

        return false;
      });
    }

    return res.json({ success: true, data: plans });
  } catch (err) {
    console.error('Error fetching action plans:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/action-plans/:id - Fetch single action plan
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const currentUser = req.user;
    const isSuper = ['SuperAdmin', 'Founder'].includes(currentUser.role);

    const plan = await ActionPlan.findByPk(req.params.id, {
      include: [{ model: Project, as: 'Project', attributes: ['project_id', 'title', 'created_by', 'business_entity', 'department'], required: false }]
    });
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Action plan not found' });
    }

    if (!isSuper) {
      const userBizStr = currentUser.business_entities || '';
      const userBizs = userBizStr ? userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

      // Identify the Owner (Admin) for this user's organization
      let orgAdminId = String(currentUser.user_id || '').trim().toLowerCase();
      let orgAdminEmail = String(currentUser.email || '').trim().toLowerCase();
      
      if (currentUser.role !== 'Admin' && currentUser.approved_by) {
        orgAdminId = String(currentUser.approved_by || '').trim().toLowerCase();
      }

      const allUsers = await User.findAll({ attributes: ['user_id', 'email', 'business_entities', 'approved_by'] });
      const sameOrgUsers = allUsers.filter(u => {
        const uid = String(u.user_id || '').trim().toLowerCase();
        const uemail = String(u.email || '').trim().toLowerCase();
        const uapp = String(u.approved_by || '').trim().toLowerCase();

        if (uid === orgAdminId || uemail === orgAdminId || uapp === orgAdminId || uid === orgAdminEmail || uemail === orgAdminEmail || uapp === orgAdminEmail) {
          return true;
        }

        const uBizs = (u.business_entities || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        return userBizs.length > 0 && userBizs.some(b => uBizs.includes(b));
      });
      const sameOrgUserIds = [orgAdminId, ...sameOrgUsers.map(u => String(u.user_id || '').toLowerCase())];
      const sameOrgEmails = [orgAdminEmail, ...sameOrgUsers.map(u => String(u.email || '').toLowerCase())].filter(Boolean);

      const planCreatedBy = String(plan.created_by || '').trim().toLowerCase();
      let hasAccess = false;
      
      if (!planCreatedBy || sameOrgUserIds.includes(planCreatedBy) || sameOrgEmails.includes(planCreatedBy)) {
        hasAccess = true;
      }

      if (!hasAccess && plan.Project) {
        const projCreatedBy = String(plan.Project.created_by || '').trim().toLowerCase();
        const projBiz = String(plan.Project.business_entity || '').trim().toLowerCase();

        hasAccess = (projCreatedBy && (sameOrgUserIds.includes(projCreatedBy) || sameOrgEmails.includes(projCreatedBy))) ||
                    (userBizs.length > 0 && projBiz && userBizs.some(b => b === projBiz || projBiz.includes(b) || b.includes(projBiz)));
      }

      if (!hasAccess) {
        return res.status(403).json({ success: false, error: 'Access denied to this action plan' });
      }
    }

    return res.json({ success: true, data: plan });
  } catch (err) {
    console.error('Error fetching action plan:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/action-plans - Create action plan
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { projectId, title, startDate, durationDays, checkpointDays, structure } = req.body;

    if (!projectId) {
      return res.status(400).json({ success: false, error: 'Project ID is required' });
    }

    const planId = 'AP_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    const newPlan = await ActionPlan.create({
      plan_id: planId,
      project_id: projectId,
      title: title || 'Project Action Plan',
      start_date: startDate || new Date().toISOString().split('T')[0],
      duration_days: durationDays || 180,
      checkpoint_days: checkpointDays || 60,
      structure: structure || [],
      created_by: req.user.user_id || req.user.email
    });

    const populatedPlan = await ActionPlan.findByPk(planId, {
      include: [{ model: Project, as: 'Project', attributes: ['project_id', 'title'], required: false }]
    });

    return res.json({ success: true, data: populatedPlan });
  } catch (err) {
    console.error('Error creating action plan:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PUT /api/action-plans/:id - Update action plan structure or metadata
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const plan = await ActionPlan.findByPk(req.params.id);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Action plan not found' });
    }

    const { title, startDate, durationDays, checkpointDays, structure, isEnabled } = req.body;

    await plan.update({
      title: title !== undefined ? title : plan.title,
      start_date: startDate !== undefined ? startDate : plan.start_date,
      duration_days: durationDays !== undefined ? durationDays : plan.duration_days,
      checkpoint_days: checkpointDays !== undefined ? checkpointDays : plan.checkpoint_days,
      structure: structure !== undefined ? structure : plan.structure,
      is_enabled: isEnabled !== undefined ? isEnabled : plan.is_enabled
    });

    const updatedPlan = await ActionPlan.findByPk(req.params.id, {
      include: [{ model: Project, as: 'Project', attributes: ['project_id', 'title'], required: false }]
    });

    return res.json({ success: true, data: updatedPlan });
  } catch (err) {
    console.error('Error updating action plan:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. PATCH /api/action-plans/:id/toggle-task - Fast inline toggle task completion
router.patch('/:id/toggle-task', authMiddleware, async (req, res) => {
  try {
    const plan = await ActionPlan.findByPk(req.params.id);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Action plan not found' });
    }

    const { pillarId, subheadingId, taskId, completed } = req.body;

    let currentStructure = plan.structure;
    if (typeof currentStructure === 'string') {
      currentStructure = JSON.parse(currentStructure);
    }

    let itemUpdated = false;
    currentStructure = currentStructure.map(pillar => {
      if (pillar.id === pillarId || !pillarId) {
        const updatedSubheadings = (pillar.subheadings || []).map(sub => {
          if (sub.id === subheadingId || !subheadingId) {
            const updatedTasks = (sub.tasks || []).map(task => {
              if (task.id === taskId) {
                itemUpdated = true;
                return { ...task, completed: completed !== undefined ? completed : !task.completed };
              }
              return task;
            });
            return { ...sub, tasks: updatedTasks };
          }
          return sub;
        });
        return { ...pillar, subheadings: updatedSubheadings };
      }
      return pillar;
    });

    if (!itemUpdated) {
      return res.status(400).json({ success: false, error: 'Target task not found in plan structure' });
    }

    await plan.update({ structure: currentStructure });

    const updatedPlan = await ActionPlan.findByPk(req.params.id, {
      include: [{ model: Project, as: 'Project', attributes: ['project_id', 'title'], required: false }]
    });

    return res.json({ success: true, data: updatedPlan });
  } catch (err) {
    console.error('Error toggling action plan task:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. DELETE /api/action-plans/:id - Delete action plan
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const targetId = req.params.id;

    // Direct deletion query covering plan_id field
    const deletedCount = await ActionPlan.destroy({
      where: {
        [Op.or]: [
          { plan_id: targetId }
        ]
      }
    });

    if (deletedCount === 0) {
      // Fallback: try finding by Primary Key
      const plan = await ActionPlan.findByPk(targetId);
      if (plan) {
        await plan.destroy();
      }
    }

    return res.json({
      success: true,
      message: `Action plan ${targetId} deleted successfully.`
    });
  } catch (err) {
    console.error('Error deleting action plan:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. POST /api/action-plans/:id/assign-task - Assign an Action Plan task to an employee and create official Task
router.post('/:id/assign-task', authMiddleware, async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const targetId = req.params.id;

    let plan = await ActionPlan.findOne({
      where: {
        [Op.or]: [
          { plan_id: targetId }
        ]
      }
    });

    if (!plan) {
      plan = await ActionPlan.findByPk(targetId);
    }

    if (!plan) {
      return res.status(404).json({ success: false, error: 'Action plan not found' });
    }

    const { pillarId, subheadingId, taskId, assignedTo, department, startDate, dueDate, storyPoints } = req.body;

    if (!assignedTo) {
      return res.status(400).json({ success: false, error: 'Employee assignment (assignedTo) is required' });
    }

    let currentStructure = plan.structure;
    if (typeof currentStructure === 'string') {
      try { currentStructure = JSON.parse(currentStructure); } catch (e) { currentStructure = []; }
    }

    let targetTaskTitle = 'Action Plan Task';
    let itemUpdated = false;

    currentStructure = currentStructure.map(pillar => {
      if (pillar.id === pillarId || !pillarId) {
        const updatedSubheadings = (pillar.subheadings || []).map(sub => {
          if (sub.id === subheadingId || !subheadingId) {
            const updatedTasks = (sub.tasks || []).map(task => {
              if (task.id === taskId) {
                itemUpdated = true;
                targetTaskTitle = task.title;
                return {
                  ...task,
                  assignedTo: assignedTo,
                  department: department || 'Operations',
                  startDate: startDate || new Date().toISOString().split('T')[0],
                  dueDate: dueDate || null,
                  storyPoints: Number(storyPoints) || 0
                };
              }
              return task;
            });
            return { ...sub, tasks: updatedTasks };
          }
          return sub;
        });
        return { ...pillar, subheadings: updatedSubheadings };
      }
      return pillar;
    });

    if (!itemUpdated) {
      return res.status(400).json({ success: false, error: 'Target task not found in plan structure' });
    }

    // Save updated structure to Action Plan
    await plan.update({ structure: currentStructure });

    // Safely check if plan.project_id maps to an existing project in projects table
    const { Department, User } = require('../models');

    let validProjectId = null;
    let resolvedBiz = req.body.businessEntity || null;

    if (plan.project_id) {
      const existingProject = await Project.findOne({
        where: {
          [Op.or]: [
            { project_id: plan.project_id },
            { title: plan.project_id }
          ]
        }
      });
      if (existingProject) {
        validProjectId = existingProject.project_id;
        if (!resolvedBiz) resolvedBiz = existingProject.business_entity;
      }
    }

    if (!resolvedBiz && assignedTo) {
      const firstAssignee = String(assignedTo).split(',')[0].trim();
      const assigneeUser = await User.findOne({
        where: {
          [Op.or]: [
            { user_id: firstAssignee },
            { full_name: firstAssignee },
            { email: firstAssignee }
          ]
        }
      });
      if (assigneeUser && assigneeUser.business_entities) {
        resolvedBiz = assigneeUser.business_entities.split(',')[0].trim();
      }
    }

    if (!resolvedBiz && department) {
      const firstDept = String(department).split(',')[0].trim();
      const deptRecord = await Department.findOne({
        where: {
          [Op.or]: [
            { department_id: firstDept },
            { name: firstDept }
          ]
        }
      });
      if (deptRecord && deptRecord.business_entities) {
        resolvedBiz = deptRecord.business_entities.split(',')[0].trim();
      }
    }

    if (!resolvedBiz && req.user && req.user.business_entities) {
      resolvedBiz = req.user.business_entities.split(',')[0].trim();
    }

    if (!resolvedBiz) {
      resolvedBiz = 'Company X (Shared)';
    }

    // Create official Task record in main Task Management DB directly for the assigned Action Plan item
    const newTaskId = 'TSK_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const createdTask = await Task.create({
      task_id: newTaskId,
      parent_task_id: null,
      title: targetTaskTitle,
      description: `[AP:${plan.plan_id}:${taskId}] Assigned from Action Plan: ${plan.title} (Project: ${plan.project_id || 'N/A'})`,
      assigned_to: assignedTo,
      assigned_by: req.user ? (req.user.name || req.user.full_name || req.user.user_id || req.user.email) : 'System',
      business_entity: resolvedBiz,
      department: department || 'Operations',
      start_date: startDate || new Date().toISOString().split('T')[0],
      due_date: dueDate || null,
      story_points: Number(storyPoints) || 0,
      project_id: validProjectId,
      status: 'Not Started',
      priority: 'Medium',
      created_by: req.user ? (req.user.user_id || req.user.email) : 'System'
    });

    // Dispatch Telegram notification for Action Plan assigned task
    try {
      const { sendTelegramTaskAssignment } = require('../services/telegram');
      await sendTelegramTaskAssignment(createdTask, null, req.user);
    } catch (telErr) {
      console.error('[Telegram] Action Plan task notification error:', telErr.message);
    }

    const updatedPlan = await ActionPlan.findOne({
      where: { plan_id: plan.plan_id },
      include: [{ model: Project, as: 'Project', attributes: ['project_id', 'title'], required: false }]
    });

    return res.json({
      success: true,
      message: `Task successfully assigned to ${assignedTo} and synced to Task Board!`,
      data: updatedPlan,
      createdTask
    });
  } catch (err) {
    console.error('Error assigning action plan task:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
