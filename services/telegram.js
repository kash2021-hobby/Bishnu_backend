const axios = require('axios');
const { Department } = require('../models');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send a rich HTML formatted message to a Telegram Chat ID via Telegram Bot API
 * @param {string} chatId - Telegram Chat ID (e.g. -1001234567890)
 * @param {string} text - HTML formatted message
 * @param {string} [botToken] - Optional custom Telegram bot token
 */
async function sendTelegramMessage(chatId, text, botToken) {
  const rawToken = botToken || process.env.TELEGRAM_BOT_TOKEN;
  const token = (rawToken || '').trim().replace(/[\r\n\t]/g, '');
  let targetChatId = String(chatId || process.env.TELEGRAM_DEFAULT_CHAT_ID || '').trim().replace(/[\r\n\t]/g, '');

  if (targetChatId === '-1001234567890') {
    targetChatId = process.env.TELEGRAM_DEFAULT_CHAT_ID || '';
  }

  if (!token || !targetChatId) {
    console.log('[Telegram Service] ℹ️ Telegram alert skipped: No valid Chat ID configured.');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: targetChatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    });

    if (response.data && response.data.ok) {
      console.log(`[Telegram Service] ✅ Success: Alert dispatched to Telegram Chat ${targetChatId}`);
      return true;
    } else {
      console.error('[Telegram Service] ❌ Telegram API Returned Failed:', response.data);
      return false;
    }
  } catch (error) {
    const errData = error.response ? error.response.data : null;
    
    // Auto-heal Supergroup Chat ID migration if Telegram upgraded the group
    if (errData && errData.parameters && errData.parameters.migrate_to_chat_id) {
      const newSupergroupId = errData.parameters.migrate_to_chat_id;
      console.log(`[Telegram Service] 🔄 Group Chat upgraded to Supergroup. Re-sending to new Chat ID: ${newSupergroupId}...`);
      return await sendTelegramMessage(newSupergroupId, text, token);
    }

    if (errData && (errData.description || '').includes('chat not found')) {
      console.log(`[Telegram Service] ℹ️ Telegram alert skipped for Chat ID "${targetChatId}": Chat not found. (Add Telegram bot to group or set valid Chat ID in Settings).`);
      return false;
    }

    console.error('[Telegram Service] ⚠️ Telegram API Exception:', errData || error.message);
    return false;
  }
}

/**
 * Send a formatted Task Assignment Card to a Department's Telegram Space
 * @param {Object} task - Task object
 * @param {Object|string} [assignee] - Optional assignee user object, or ID/name string
 * @param {Object} [assigner] - Optional assigner user object
 */
async function sendTelegramTaskAssignment(task, assignee, assigner) {
  if (!task) return false;

  const deptName = task.department || 'Operations';

  let chatId = '';
  let botToken = '';

  try {
    const { Department, User, Task } = require('../models');
    const { Op } = require('sequelize');

    // ─── 1. Bot Token — from the task creator's admin user profile ───────────────
    // Each account owner stores one bot token on their user row.
    // Full multi-tenant isolation: Owner A's token never touches Owner B's data.
    let adminUser = assigner;
    if (!adminUser && task.created_by) {
      adminUser = await User.findOne({
        where: {
          [Op.or]: [
            { user_id: task.created_by },
            { email: String(task.created_by).trim().toLowerCase() }
          ]
        }
      });
    }
    if (adminUser && adminUser.telegram_bot_token) {
      botToken = adminUser.telegram_bot_token.trim().replace(/[\r\n\t]/g, '');
    }
    if (!botToken && process.env.TELEGRAM_BOT_TOKEN) {
      botToken = process.env.TELEGRAM_BOT_TOKEN;
    }

    // ─── 2. Chat ID — from the task's DEPARTMENT (primary routing) ───────────────
    // Each department has its own Telegram group chat ID.
    // For subtasks: if department is missing, inherit from parent task.
    let resolvedDeptName = (task.department || '').trim().toLowerCase();

    if (!resolvedDeptName && task.parent_task_id) {
      try {
        const parentTask = await Task.findOne({ where: { task_id: task.parent_task_id } });
        if (parentTask && parentTask.department) {
          resolvedDeptName = parentTask.department.trim().toLowerCase();
        }
      } catch (pErr) {
        console.warn('[Telegram Service] Could not fetch parent task for dept:', pErr.message);
      }
    }

    if (resolvedDeptName) {
      const allDepartments = await Department.findAll();
      const deptMatch = allDepartments.find(d => {
        const dName = (d.name || '').trim().toLowerCase();
        return dName === resolvedDeptName ||
               dName.startsWith(resolvedDeptName) ||
               resolvedDeptName.startsWith(dName) ||
               (resolvedDeptName.includes('tech') && dName.includes('tech'));
      });
      if (deptMatch && deptMatch.telegram_chat_id && deptMatch.telegram_chat_id !== '-1001234567890') {
        chatId = deptMatch.telegram_chat_id.trim().replace(/[\r\n\t]/g, '');
      }
    }

    // ─── 3. Admin user-level Chat ID fallback ────────────────────────────────────
    if (!chatId && adminUser && adminUser.telegram_chat_id) {
      chatId = adminUser.telegram_chat_id.trim().replace(/[\r\n\t]/g, '');
    }

    // ─── 4. Global process.env fallback ──────────────────────────────────────────
    if (!chatId && process.env.TELEGRAM_DEFAULT_CHAT_ID) {
      chatId = process.env.TELEGRAM_DEFAULT_CHAT_ID;
    }
    if (chatId === '-1001234567890') chatId = process.env.TELEGRAM_DEFAULT_CHAT_ID || '';

  } catch (err) {
    console.error('[Telegram Service] Error resolving Telegram credentials:', err.message);
  }


  // If we still don't have both, skip — do NOT borrow from another workspace
  if (!botToken || !chatId) {
    console.log(`[Telegram Service] ℹ️ Telegram alert skipped for business "${task.business_entity || 'Unknown'}": Bot Token: ${botToken ? '✅' : '❌'}, Chat ID: ${chatId ? '✅' : '❌'}. Configure both in Settings > Integrations for this workspace.`);
    return false;
  }

  const desc = task.description || task.Description || '';
  const isSubtask = Boolean(
    task.is_subtask ||
    task.IsSubtask ||
    task.parent_task_id ||
    task.ParentTaskID ||
    desc.includes('[AP:') ||
    desc.startsWith('Sub-task of:')
  );

  const isActionPlanTask = desc.includes('[AP:') || desc.includes('Assigned from Action Plan:');
  const taskTypeTag = isSubtask
    ? (isActionPlanTask ? '📌 <b>ACTION PLAN SUB-TASK ASSIGNED</b>' : '📌 <b>SUB-TASK ASSIGNED</b>')
    : '👑 <b>MAIN TASK CREATED</b>';

  // Resolve Assignee Name(s)
  let assigneeName = '';
  if (assignee && typeof assignee === 'object') {
    assigneeName = assignee.full_name || assignee.name || assignee.email || '';
  } else if (typeof assignee === 'string' && assignee.trim()) {
    assigneeName = assignee.trim();
  }

  if (!assigneeName && task.assigned_to) {
    try {
      const { User } = require('../models');
      const { Op } = require('sequelize');
      const rawIds = String(task.assigned_to).split(',').map(s => s.trim()).filter(Boolean);
      if (rawIds.length > 0) {
        const usersFound = await User.findAll({
          where: {
            [Op.or]: [
              { user_id: { [Op.in]: rawIds } },
              { email: { [Op.in]: rawIds } }
            ]
          }
        });
        const nameMap = {};
        usersFound.forEach(u => {
          nameMap[u.user_id] = u.full_name || u.email;
          if (u.email) nameMap[u.email] = u.full_name || u.email;
        });
        const names = rawIds.map(id => nameMap[id] || id);
        assigneeName = names.join(', ');
      }
    } catch (e) {
      assigneeName = String(task.assigned_to);
    }
  }

  if (!assigneeName) {
    assigneeName = 'Department Team Queue';
  }

  // Resolve Assigner Name
  let assignerName = '';
  if (assigner && typeof assigner === 'object') {
    assignerName = assigner.full_name || assigner.name || assigner.email || '';
  } else if (task.assigned_by) {
    assignerName = task.assigned_by;
  } else {
    assignerName = 'Admin / Dept Head';
  }

  // Resolve Parent Task Title or Action Plan for Subtasks
  let parentTaskLine = '';
  if (task.parent_task_id) {
    try {
      const { Task } = require('../models');
      const parentTask = await Task.findOne({ where: { task_id: task.parent_task_id } });
      if (parentTask) {
        parentTaskLine = `🔗 <b>Parent Task:</b> ${escapeHtml(parentTask.title)}\n`;
      }
    } catch (pErr) {}
  } else if (isActionPlanTask) {
    const apMatch = desc.match(/Assigned from Action Plan:\s*([^(]+)/);
    const apTitle = apMatch ? apMatch[1].trim() : null;
    if (apTitle) {
      parentTaskLine = `📋 <b>Action Plan:</b> ${escapeHtml(apTitle)}\n`;
    }
  }

  // Clean description for telegram display
  let cleanDesc = desc;
  if (cleanDesc.includes('[AP:')) {
    cleanDesc = cleanDesc.replace(/\[AP:[^\]]+\]\s*/g, '');
  }

  const priority = task.priority || 'Medium';
  const dueDateStr = task.due_date ? task.due_date : 'No deadline specified';
  const entity = task.business_entity || 'Company X';
  const storyPointsStr = task.story_points ? `📊 <b>Story Points:</b> ${escapeHtml(task.story_points)} SP\n` : '';
  const detailsLine = cleanDesc ? `\n📝 <b>Details:</b> <i>"${escapeHtml(cleanDesc)}"</i>\n` : '';

  const message = `${taskTypeTag}: <b>${escapeHtml(task.title)}</b>\n` +
    parentTaskLine +
    `───────────────────────────────\n` +
    `👤 <b>Assigned To:</b> ${escapeHtml(assigneeName)}\n` +
    `👤 <b>Assigned By:</b> ${escapeHtml(assignerName)}\n` +
    `🎯 <b>Department:</b> ${escapeHtml(deptName)}\n` +
    `🏢 <b>Business Entity:</b> ${escapeHtml(entity)}\n` +
    `⚡ <b>Priority:</b> ${escapeHtml(priority)}\n` +
    storyPointsStr +
    `📅 <b>Due Date:</b> ${escapeHtml(dueDateStr)}\n` +
    detailsLine +
    `\n🚀 <b>Status:</b> ${escapeHtml(task.status || 'Not Started')}`;

  const result = await sendTelegramMessage(chatId, message, botToken);
  
  if (task.project_id) {
    await forwardToClientChatroom(task.project_id, message, botToken);
  }

  return result;
}

/**
 * Forwards a message to the client's dedicated project chatroom if configured.
 */
async function forwardToClientChatroom(projectId, message, botToken) {
  try {
    const { Project } = require('../models');
    const project = await Project.findOne({ where: { project_id: projectId } });
    if (project && project.telegram_chat_id) {
      console.log(`[Telegram Service] Forwarding alert to Client Project Chat ID: ${project.telegram_chat_id}`);
      // Send the same message to the client's project chatroom
      await sendTelegramMessage(project.telegram_chat_id, message, botToken);
    }
  } catch (err) {
    console.error('[Telegram Service] Failed to forward to client chatroom:', err.message);
  }
}

module.exports = {
  sendTelegramMessage,
  sendTelegramTaskAssignment,
  forwardToClientChatroom
};
