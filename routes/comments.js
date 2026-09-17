const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Comment, Task, User, Department, AuditLog } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { sendTelegramMessage, forwardToClientChatroom } = require('../services/telegram');
const { uploadFileToDriveFolder } = require('../services/driveService');
// Configure Multer Storage for Document Attachments
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    cb(null, uniqueSuffix + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max file size
});

// 1. GET /api/comments/:taskId — Fetch all comments for task or sub-task
router.get('/:taskId', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.params;
    const comments = await Comment.findAll({
      where: { task_id: taskId },
      order: [['created_at', 'ASC']]
    });

    const formatted = comments.map(c => ({
      CommentID: c.comment_id,
      TaskID: c.task_id,
      AuthorID: c.author_id,
      AuthorName: c.author_name,
      CommentText: c.comment_text,
      TaggedUsers: c.tagged_users || [],
      DocumentUrl: c.document_url,
      DocumentName: c.document_name,
      CreatedAt: c.created_at
    }));

    return res.json({ success: true, data: formatted });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST /api/comments — Add new comment with optional tagged employees & file upload
router.post('/', authMiddleware, upload.single('document'), async (req, res) => {
  try {
    const { taskId, commentText, taggedUsers } = req.body;

    if (!taskId || !commentText || !commentText.trim()) {
      return res.status(400).json({ success: false, error: 'Task ID and comment text are required.' });
    }

    const task = await Task.findOne({ where: { task_id: taskId } });
    if (!task) {
      return res.status(404).json({ success: false, error: 'Target task or sub-task not found.' });
    }

    let parsedTaggedUsers = [];
    if (taggedUsers) {
      try {
        parsedTaggedUsers = typeof taggedUsers === 'string' ? JSON.parse(taggedUsers) : taggedUsers;
      } catch (e) {
        parsedTaggedUsers = Array.isArray(taggedUsers) ? taggedUsers : [taggedUsers];
      }
    }

    let documentUrl = null;
    let documentName = null;

    if (req.file) {
      documentName = req.file.originalname;
      const driveUpload = await uploadFileToDriveFolder(
        req.user,
        null, // Use Admin's default folder
        req.file.path,
        req.file.originalname,
        req.file.mimetype
      );

      // Clean up local temp file immediately
      fs.unlinkSync(req.file.path);

      if (!driveUpload) {
        return res.status(500).json({ success: false, error: 'Google Drive integration is not configured or upload failed. Files cannot be saved on this server.' });
      }

      documentUrl = driveUpload.webViewLink;
    }

    const commentId = 'CMT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    const newComment = await Comment.create({
      comment_id: commentId,
      task_id: taskId,
      author_id: req.user.user_id,
      author_name: req.user.full_name || req.user.email,
      comment_text: commentText.trim(),
      tagged_users: parsedTaggedUsers,
      document_url: documentUrl,
      document_name: documentName
    });

    // ── Resolve Admin Bot Token for workspace-isolated Telegram notifications ──
    let adminBotToken = null;
    if (req.user.telegram_bot_token) {
      adminBotToken = req.user.telegram_bot_token.trim().replace(/[\r\n\t]/g, '');
    }
    if (!adminBotToken) {
      // Try to find the admin who approved this user (workspace owner)
      if (req.user.approved_by) {
        const { Op } = require('sequelize');
        const adminOwner = await User.findOne({
          where: {
            [Op.or]: [
              { user_id: req.user.approved_by },
              { email: String(req.user.approved_by).trim().toLowerCase() }
            ]
          }
        });
        if (adminOwner && adminOwner.telegram_bot_token) {
          adminBotToken = adminOwner.telegram_bot_token.trim().replace(/[\r\n\t]/g, '');
        }
      }
    }
    if (!adminBotToken && process.env.TELEGRAM_BOT_TOKEN) {
      adminBotToken = process.env.TELEGRAM_BOT_TOKEN;
    }

    // Telegram Notifications for Tagged Employees (workspace-scoped)
    if (parsedTaggedUsers && parsedTaggedUsers.length > 0) {
      for (const taggedUserVal of parsedTaggedUsers) {
        // Find tagged user by UserID, Email, or Full Name
        const taggedUser = await User.findOne({
          where: {
            [require('sequelize').Op.or]: [
              { user_id: taggedUserVal },
              { email: taggedUserVal },
              { full_name: taggedUserVal }
            ]
          }
        });

        if (taggedUser) {
          // Find tagged user's department telegram chat ID — scoped by business entity
          const userBizEntities = (req.user.business_entities || '').split(',').map(s => s.trim()).filter(Boolean);
          let deptWhereClause = {
            name: {
              [require('sequelize').Op.like]: `%${taggedUser.department || ''}%`
            }
          };
          // Scope department lookup to the same business entity to prevent cross-workspace matches
          if (userBizEntities.length > 0) {
            const bizOrConditions = userBizEntities.map(b => ({
              business_entities: { [require('sequelize').Op.like]: `%${b}%` }
            }));
            deptWhereClause[require('sequelize').Op.or] = bizOrConditions;
          }

          const userDept = await Department.findOne({ where: deptWhereClause });

          const targetChatId = userDept?.telegram_chat_id || process.env.TELEGRAM_DEFAULT_CHAT_ID || '-1004410580381';

          const tagMessage = 
            `💬 <b>New Mention / Comment Alert!</b>\n` +
            `👤 <b>Tagged:</b> @${taggedUser.full_name || taggedUser.email}\n` +
            `✍️ <b>By:</b> ${req.user.full_name || req.user.email}\n` +
            `📌 <b>Task:</b> ${task.title}\n` +
            `🏢 <b>Department:</b> ${task.department}\n` +
            `💬 <b>Comment:</b> "${commentText.trim()}"` +
            (documentName ? `\n📎 <b>Attachment:</b> ${documentName}` : ``);

          await sendTelegramMessage(targetChatId, tagMessage, adminBotToken);
        }
      }
    }
    
    // Always forward comment to Client Chatroom (if the task belongs to a project with one)
    if (task.project_id) {
      const clientMsg = 
        `💬 <b>New Comment on Task</b>\n` +
        `👤 <b>By:</b> ${req.user.full_name || req.user.email}\n` +
        `📌 <b>Task:</b> ${task.title}\n` +
        `💬 <b>Comment:</b> "${commentText.trim()}"` +
        (documentName ? `\n📎 <b>Attachment:</b> ${documentName}` : ``);
      
      await forwardToClientChatroom(task.project_id, clientMsg, adminBotToken);
    }

    
    // --- Audit Log: comment ---
    await AuditLog.create({
      log_id: 'LOG_' + Date.now() + '_' + Math.random().toString(36).substr(2,5),
      user_id: req.user.user_id,
      action: 'comment',
      entity_type: 'Task',
      entity_id: taskId,
      details: `Commented: "${commentText.trim()}"`,
      business_entity: task.business_entity || ''
    });

    return res.json({
      success: true,
      data: {
        CommentID: newComment.comment_id,
        TaskID: newComment.task_id,
        AuthorID: newComment.author_id,
        AuthorName: newComment.author_name,
        CommentText: newComment.comment_text,
        TaggedUsers: newComment.tagged_users,
        DocumentUrl: newComment.document_url,
        DocumentName: newComment.document_name,
        CreatedAt: newComment.created_at
      },
      message: 'Comment added successfully.'
    });
  } catch (err) {
    console.error('Comment creation error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
