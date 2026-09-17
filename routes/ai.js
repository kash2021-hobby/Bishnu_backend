const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { generateTaskFormWithAI } = require('../services/aiService');

router.post('/autofill', authMiddleware, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required' });

    const taskData = await generateTaskFormWithAI(prompt);
    return res.json({ success: true, data: taskData });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/chat', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message is required' });

    const currentUser = req.user;
    const { Task, User, Department, Project } = require('../models');

    let tasks = await Task.findAll();
    let projects = await Project.findAll();
    let depts = await Department.findAll();
    let users = await User.findAll({ where: { status: 'Active' } });

    // ——— ROLE-BASED DATA ISOLATION & SCOPING ———
    let contextScopeDescription = '';
    const userIdStr = String(currentUser.user_id || '').toLowerCase();
    const userEmailStr = String(currentUser.email || '').toLowerCase();
    const userNameStr = String(currentUser.full_name || '').toLowerCase();

    if (currentUser.role === 'TeamMember') {
      // 1. Employee: Strictly filter tasks & projects assigned to this user
      const ownAdminId = String(currentUser.approved_by || '').trim().toLowerCase();

      tasks = tasks.filter(t => {
        const createdBy = String(t.created_by || '').trim().toLowerCase();
        const isOwnAdmin = createdBy === ownAdminId;
        const isAssigned = String(t.assigned_to || '').includes(currentUser.user_id) ||
                           t.assigned_to === currentUser.email;
        return isOwnAdmin && isAssigned;
      });
      
      const myTaskProjectIds = new Set(tasks.map(t => t.project_id).filter(Boolean));
      projects = projects.filter(p => myTaskProjectIds.has(p.project_id));

      const userDeptStr = (currentUser.department || '').toLowerCase();
      depts = depts.filter(d => userDeptStr.includes((d.name || '').toLowerCase()));
      users = [currentUser];

      contextScopeDescription = `User Role: Employee (${currentUser.full_name}, Email: ${currentUser.email}). STRICT SECURITY RULE: You only have access to tasks and projects assigned directly to ${currentUser.full_name}. If the user asks about other employees' tasks, other department stats, or company-wide data, politely state that you can only provide information on their own assigned tasks and projects.`;

    } else if (currentUser.role === 'DeptAdmin') {
      // 2. Dept Head: Strictly filter to their Admin owner's data + their department only
      const userDeptStr = (currentUser.department || '').toLowerCase();
      const userDepts = userDeptStr.split(',').map(s => s.trim()).filter(Boolean);
      const ownAdminId = String(currentUser.approved_by || '').trim().toLowerCase();

      // Scope to Admin owner's tasks first, then to this dept
      tasks = tasks.filter(t => {
        const createdBy = String(t.created_by || '').trim().toLowerCase();
        if (createdBy !== ownAdminId) return false;
        const tDept = (t.department || '').toLowerCase().trim();
        return userDepts.some(ud => ud === tDept || (tDept && (ud.includes(tDept) || tDept.includes(ud))));
      });

      projects = projects.filter(p => {
        const createdBy = String(p.created_by || '').trim().toLowerCase();
        if (createdBy !== ownAdminId) return false;
        const pDept = (p.department || '').toLowerCase().trim();
        const matchesDept = userDepts.some(ud => ud === pDept || (pDept && (ud.includes(pDept) || pDept.includes(ud))));
        const leads = (p.project_lead || '').split(',').map(s => s.trim().toLowerCase());
        const isLead = leads.includes(userIdStr) || leads.includes(userEmailStr);
        const hasDeptTask = tasks.some(t => t.project_id === p.project_id);
        return matchesDept || isLead || hasDeptTask;
      });

      depts = depts.filter(d => {
        const dName = (d.name || '').toLowerCase().trim();
        return userDepts.some(ud => ud === dName || ud.includes(dName) || dName.includes(ud));
      });

      users = users.filter(u => {
        const uAppr = String(u.approved_by || '').trim().toLowerCase();
        const uDeptStr = (u.department || '').toLowerCase();
        return (uAppr === ownAdminId) && userDepts.some(ud => uDeptStr.includes(ud));
      });

      contextScopeDescription = `User Role: Department Head (${currentUser.full_name}, Department: ${currentUser.department}). STRICT SECURITY RULE: You only have access to department data for the "${currentUser.department}" department. If the user asks about other departments, other admins' data, or company-wide confidential data, politely state that you only have access to details regarding the ${currentUser.department} department.`;

    } else if (['SuperAdmin', 'Founder'].includes(currentUser.role)) {
      // 3. SuperAdmin / Founder: Unlimited access
      contextScopeDescription = `User Role: SuperAdmin / Founder (${currentUser.full_name}). You have full organization-wide administrative access to all departments, projects, employees, and tasks.`;

    } else {
      // 4. Admin: Only their own org data
      tasks = tasks.filter(t => {
        const createdBy = String(t.created_by || '').trim().toLowerCase();
        return createdBy === userIdStr || createdBy === userEmailStr;
      });

      projects = projects.filter(p => {
        const createdBy = String(p.created_by || '').trim().toLowerCase();
        return createdBy === userIdStr || createdBy === userEmailStr;
      });

      depts = depts.filter(d => {
        const dAdmin = String(d.admin_id || '').trim().toLowerCase();
        const dEmail = String(d.admin_email || '').trim().toLowerCase();
        return dAdmin === userIdStr || dAdmin === userEmailStr || dEmail === userEmailStr;
      });

      users = users.filter(u => {
        const uid = String(u.user_id || '').trim().toLowerCase();
        const uemail = String(u.email || '').trim().toLowerCase();
        const uAppr = String(u.approved_by || '').trim().toLowerCase();
        if (uid === userIdStr || uemail === userEmailStr) return true;
        return uAppr === userIdStr || uAppr === userEmailStr;
      });

      contextScopeDescription = `User Role: Admin (${currentUser.full_name}, Email: ${currentUser.email}). You have access to all departments, projects, tasks, and members within your organization. STRICT SECURITY RULE: You do NOT have access to other admins' or organizations' data. If the user asks about data outside their own organization, politely decline.`;
    }

    const taskSummary = tasks.slice(0, 50).map(t => `- [Task #${t.task_id}] "${t.title}" | Status: ${t.status} | Priority: ${t.priority} | Dept: ${t.department || 'N/A'} | AssignedTo: ${t.assigned_to || 'Unassigned'} | Due: ${t.due_date || 'N/A'}`).join('\n');
    const projectSummary = projects.slice(0, 30).map(p => `- [Project #${p.project_id}] "${p.title}" | Status: ${p.status} | Lead: ${p.project_lead || 'Unassigned'} | Due: ${p.due_date || 'N/A'}`).join('\n');

    const summaryText = `${contextScopeDescription}

--- SCOPED ACCESSIBLE DATA ---
PROJECTS ACCESSIBLE (${projects.length}):
${projectSummary || 'No active projects found in your scope.'}

TASKS ACCESSIBLE (${tasks.length}):
${taskSummary || 'No tasks found in your scope.'}

DEPARTMENTS ACCESSIBLE: ${depts.map(d=>d.name).join(', ') || 'N/A'}
EMPLOYEE MEMBERS IN SCOPE (${users.length}): ${users.map(u=>u.full_name).join(', ')}`;

    const axios = require('axios');
    const apiKey = process.env.GEMINI_API_KEY;

    let aiReply = '';
    if (apiKey && !apiKey.startsWith('AIzaSy_Mock')) {
      try {
        const systemPrompt = `You are an AI Operational Assistant for a multi-tenant task management platform.

CRITICAL MULTI-TENANCY SECURITY RULES:
1. Each Admin is a COMPLETELY SEPARATE organization/entity. Admin A's data is 100% invisible to Admin B. They are different companies.
2. You MUST NEVER reveal, reference, or hint at data from other organizations/admins.
3. The data provided below is ALREADY filtered to ONLY this user's permitted scope. ONLY use this data to answer questions.
4. If the user asks about data not present in the context below, say "I don't have information about that in your scope."

ROLE-SPECIFIC BOUNDARIES:
${contextScopeDescription}

RESPONSE GUIDELINES:
- Be concise and professional
- Use bullet points and formatting for clarity
- For task queries: mention task title, status, priority, assignee, due date
- For project queries: mention project title, status, progress, lead
- For workload queries: summarize task counts, delayed items, priorities
- NEVER fabricate data that isn't in the context below

${summaryText}`;

        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          contents: [{
            parts: [{
              text: `${systemPrompt}\n\nUser Question: ${message}`
            }]
          }]
        });
        aiReply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      } catch (err) {
        console.error('Gemini Chat error:', err.message);
      }
    }

    if (!aiReply) {
      // Role-Aware Smart Fallback Assistant
      const lower = message.toLowerCase();
      const doneCount = tasks.filter(t => t.status === 'Completed').length;
      const inProgressCount = tasks.filter(t => t.status === 'In Progress').length;
      const delayedCount = tasks.filter(t => t.pace_status === 'Delayed' && t.status !== 'Completed').length;
      const notStartedCount = tasks.filter(t => !t.status || t.status === 'Not Started').length;

      if (currentUser.role === 'TeamMember') {
        aiReply = `🤖 **Your Personal Assistant**\n\nHello ${currentUser.full_name}! Here's your task summary:\n\n` +
          `📋 **Total Assigned Tasks:** ${tasks.length}\n` +
          `✅ Completed: ${doneCount} | 🔄 In Progress: ${inProgressCount} | ⏳ Not Started: ${notStartedCount}\n` +
          (delayedCount > 0 ? `⚠️ **${delayedCount} task(s) are delayed!**\n` : '') +
          `📁 **Projects:** ${projects.length}\n\n` +
          `_I can only help you with your own assigned tasks and projects. Ask me about your task status, deadlines, or priorities!_`;

      } else if (currentUser.role === 'DeptAdmin') {
        aiReply = `🏢 **${currentUser.department} Department Assistant**\n\nHello ${currentUser.full_name}! Here's your department overview:\n\n` +
          `📋 **Total Tasks:** ${tasks.length} | 👥 **Team Members:** ${users.length}\n` +
          `✅ Completed: ${doneCount} | 🔄 In Progress: ${inProgressCount} | ⏳ Not Started: ${notStartedCount}\n` +
          (delayedCount > 0 ? `⚠️ **${delayedCount} task(s) are delayed!**\n` : '') +
          `📁 **Projects:** ${projects.length}\n\n` +
          `_I can only help you with ${currentUser.department} department data. Ask me about your team's tasks, workload, or project progress!_`;

      } else if (['SuperAdmin', 'Founder'].includes(currentUser.role)) {
        aiReply = `👑 **Organization-Wide Assistant**\n\nHello ${currentUser.full_name}! Full overview:\n\n` +
          `🏢 **Departments:** ${depts.length} | 📁 **Projects:** ${projects.length}\n` +
          `📋 **Tasks:** ${tasks.length} | 👥 **Employees:** ${users.length}\n` +
          (delayedCount > 0 ? `⚠️ **${delayedCount} task(s) are delayed across the organization.**\n` : '') +
          `\n_You have full access. Ask me anything about any department, project, or employee!_`;

      } else {
        // Admin
        aiReply = `📊 **Your Organization Assistant**\n\nHello ${currentUser.full_name}! Here's your organization summary:\n\n` +
          `🏢 **Departments:** ${depts.length} | 📁 **Projects:** ${projects.length}\n` +
          `📋 **Tasks:** ${tasks.length} | 👥 **Team Members:** ${users.length}\n` +
          `✅ Completed: ${doneCount} | 🔄 In Progress: ${inProgressCount} | ⏳ Not Started: ${notStartedCount}\n` +
          (delayedCount > 0 ? `⚠️ **${delayedCount} task(s) are delayed!**\n` : '') +
          `\n_I can only help with your organization's data. Other admins' data is completely separate and private._`;
      }
    }

    return res.json({ success: true, reply: aiReply });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
