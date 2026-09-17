const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Project, Task, User } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

// Dynamic Multer Storage into Project-specific subfolder
const baseUploadDir = path.join(__dirname, '../uploads/projects');
if (!fs.existsSync(baseUploadDir)) {
  fs.mkdirSync(baseUploadDir, { recursive: true });
}

const bcrypt = require('bcryptjs');

async function handleExternalClients(externalClientsStr, projectId, currentUser) {
  if (!externalClientsStr) return null;
  let clients = [];
  try {
    clients = typeof externalClientsStr === 'string' ? JSON.parse(externalClientsStr) : externalClientsStr;
  } catch (err) {
    console.error('Failed to parse external clients', err);
    return null;
  }
  
  if (!Array.isArray(clients)) return null;
  
  const savedClients = [];
  for (const client of clients) {
    if (!client.email || !client.name) continue;
    const email = client.email.trim().toLowerCase();
    
    let user = await User.findOne({ where: { email } });
    if (!user) {
      const password_hash = await bcrypt.hash('Welcome@123', 10);
      user = await User.create({
        user_id: 'USR_' + Date.now() + Math.floor(Math.random()*1000),
        email,
        full_name: client.name.trim(),
        role: 'Client',
        password_hash,
        is_password_set: true,
        status: 'Active',
        approved_by: currentUser.user_id,
        client_project_ids: JSON.stringify([projectId])
      });
    } else {
      let allowedProjects = [];
      try {
        allowedProjects = user.client_project_ids ? JSON.parse(user.client_project_ids) : [];
      } catch(e) {}
      
      if (!allowedProjects.includes(projectId)) {
        allowedProjects.push(projectId);
        await user.update({ client_project_ids: JSON.stringify(allowedProjects) });
      }
    }
    
    savedClients.push({ name: user.full_name, email: user.email, user_id: user.user_id });
  }
  return JSON.stringify(savedClients);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectTitle = req.body.title || req.body.projectTitle || 'General_Project';
    const folderName = projectTitle.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
    const projectDir = path.join(baseUploadDir, folderName);

    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    cb(null, projectDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.random().toString(36).substr(2, 5)}${ext}`);
  }
});
const upload = multer({ storage });

// 1. GET /api/projects — List projects (Shared across all Admins & members of the same organization)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { department, businessEntity } = req.query;
    const currentUser = req.user;

    let projects = await Project.findAll();
    const isSuper = ['SuperAdmin', 'Founder'].includes(currentUser.role);
    const allTasks = await Task.findAll();
    const allUsers = await User.findAll();

    const userIdStr = String(currentUser.user_id || '').toLowerCase();
    const userEmailStr = String(currentUser.email || '').toLowerCase();

    if (!isSuper) {
      const userBizStr = currentUser.business_entities || '';
      const userBizs = userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      // Find all users who belong to the SAME organization as currentUser
      const sameOrgUsers = allUsers.filter(u => {
        if (u.user_id === currentUser.user_id || u.email === currentUser.email) return true;
        if (u.approved_by === currentUser.user_id || u.approved_by === currentUser.email) return true;
        const uBizs = (u.business_entities || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        return userBizs.length > 0 && userBizs.some(b => uBizs.includes(b));
      });
      const sameOrgUserIds = [userIdStr, ...sameOrgUsers.map(u => String(u.user_id || '').toLowerCase())];
      const sameOrgEmails = [userEmailStr, ...sameOrgUsers.map(u => String(u.email || '').toLowerCase())].filter(Boolean);

      if (currentUser.role === 'Admin') {
        // Admin: All Admins & members of the same organization see all projects of that organization
        projects = projects.filter(p => {
          const createdBy = String(p.created_by || '').trim().toLowerCase();
          const isCreatorMatch = sameOrgUserIds.includes(createdBy) || sameOrgEmails.includes(createdBy);

          const pBiz = String(p.business_entity || '').trim().toLowerCase();
          const isBizMatch = userBizs.length > 0 && pBiz && userBizs.some(b => b === pBiz || pBiz.includes(b));

          return isCreatorMatch || isBizMatch;
        });

      } else if (currentUser.role === 'DeptAdmin') {
        const userDepts = (currentUser.department || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

        projects = projects.filter(p => {
          const createdBy = String(p.created_by || '').trim().toLowerCase();
          const isOrgMatch = sameOrgUserIds.includes(createdBy) || sameOrgEmails.includes(createdBy);
          const pBiz = String(p.business_entity || '').trim().toLowerCase();
          const isBizMatch = userBizs.length > 0 && pBiz && userBizs.some(b => b === pBiz || pBiz.includes(b));

          if (!isOrgMatch && !isBizMatch) return false;

          const pDept = (p.department || '').toLowerCase().trim();
          const matchesDept = userDepts.some(ud => ud === pDept || (pDept && (ud.includes(pDept) || pDept.includes(ud))));
          const leadList = (p.project_lead || '').split(',').map(s => s.trim().toLowerCase());
          const isLead = leadList.includes(userIdStr) || leadList.includes(userEmailStr);
          const hasDeptTask = allTasks.some(t => {
            if (t.project_id !== p.project_id) return false;
            const tDept = (t.department || '').toLowerCase().trim();
            return userDepts.some(ud => ud === tDept || (tDept && (ud.includes(tDept) || tDept.includes(ud))));
          });

          return matchesDept || isLead || hasDeptTask;
        });

      } else if (currentUser.role === 'Client') {
        let allowedProjectIds = [];
        try {
          allowedProjectIds = currentUser.client_project_ids ? JSON.parse(currentUser.client_project_ids) : [];
        } catch(e) {}
        projects = projects.filter(p => allowedProjectIds.includes(p.project_id));
      } else {
        // TeamMember: projects in their organization where a task is assigned to them or they are lead
        projects = projects.filter(p => {
          const createdBy = String(p.created_by || '').trim().toLowerCase();
          const isOrgMatch = sameOrgUserIds.includes(createdBy) || sameOrgEmails.includes(createdBy);
          const pBiz = String(p.business_entity || '').trim().toLowerCase();
          const isBizMatch = userBizs.length > 0 && pBiz && userBizs.some(b => b === pBiz || pBiz.includes(b));

          if (!isOrgMatch && !isBizMatch) return false;

          const hasAssignedTask = allTasks.some(t =>
            t.project_id === p.project_id &&
            (String(t.assigned_to || '').includes(currentUser.user_id) ||
             String(t.assigned_to || '').toLowerCase().includes(userEmailStr))
          );
          const leadList = (p.project_lead || '').split(',').map(s => s.trim().toLowerCase());
          const isLead = leadList.includes(userIdStr) || leadList.includes(userEmailStr);

          return hasAssignedTask || isLead;
        });
      }
    }

    // Apply explicit query filters if provided
    if (businessEntity && businessEntity !== 'ALL' && businessEntity.toLowerCase() !== 'all') {
      const bFilter = businessEntity.trim().toLowerCase();
      projects = projects.filter(p => {
        const pBiz = String(p.business_entity || '').trim().toLowerCase();
        return pBiz === bFilter || pBiz.includes(bFilter);
      });
    }

    if (department && department !== 'ALL' && department.toLowerCase() !== 'all') {
      const dFilter = department.trim().toLowerCase();
      projects = projects.filter(p => {
        const pDept = String(p.department || '').trim().toLowerCase();
        return pDept === dFilter || pDept.includes(dFilter);
      });
    }

    // Calculate progress & lead details per project
    const result = projects.map(p => {
      const projTasks = allTasks.filter(t => t.project_id === p.project_id);
      const totalTasks = projTasks.length;
      const completedTasks = projTasks.filter(t => t.status === 'Completed').length;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      const leadIds = (p.project_lead || '').split(',').map(s => s.trim()).filter(Boolean);
      const leadNames = allUsers.filter(u => leadIds.includes(u.user_id) || leadIds.includes(u.email))
                                .map(u => u.full_name || u.email);
      const projectLeadName = leadNames.length > 0 ? leadNames.join(', ') : 'Unassigned';

      let docs = [];
      try {
        docs = typeof p.documents === 'string' ? JSON.parse(p.documents || '[]') : (p.documents || []);
      } catch (e) {
        docs = [];
      }

      let extClients = [];
      try {
        extClients = typeof p.external_clients === 'string' ? JSON.parse(p.external_clients || '[]') : (p.external_clients || []);
      } catch (e) {
        extClients = [];
      }

      return {
        ProjectID: p.project_id,
        Title: p.title,
        Description: p.description,
        BusinessEntity: p.business_entity,
        Department: p.department,
        Status: p.status,
        Priority: p.priority,
        ProjectLeadID: p.project_lead,
        ProjectLeadName: projectLeadName,
        StartDate: p.start_date,
        DueDate: p.due_date,
        DriveFolderUrl: p.drive_folder_url,
        Documents: docs,
        ExternalClients: extClients,
        TotalTasks: totalTasks,
        CompletedTasks: completedTasks,
        Progress: progress,
        CreatedAt: p.created_at
      };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('Fetch projects error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const { createProjectDriveFolder, uploadFileToDriveFolder } = require('../services/driveService');

// 2. POST /api/projects — Create Project & Auto-Create Named Folder (Supports Multiple Documents)
router.post('/', authMiddleware, upload.any(), async (req, res) => {
  try {
    const { title, description, businessEntity, department, priority, projectLead, startDate, dueDate, externalClients, telegramChatId } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Project title is required' });
    }

    const cleanTitle = title.trim();
    const folderName = cleanTitle.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
    const projectFolderDir = path.join(baseUploadDir, folderName);

    if (!fs.existsSync(projectFolderDir)) {
      fs.mkdirSync(projectFolderDir, { recursive: true });
    }

    const projectId = 'PRJ_' + Date.now();
    const userFirstBiz = req.user?.business_entities ? req.user.business_entities.split(',')[0].trim() : '';
    const finalBiz = (businessEntity && businessEntity !== 'Company X (Shared)')
      ? businessEntity
      : (userFirstBiz || 'General');

    let driveFolderUrl = `https://drive.google.com/drive/search?q=${encodeURIComponent(cleanTitle)}`;
    let driveFolderId = null;

    const driveFolderResult = await createProjectDriveFolder(req.user, cleanTitle);
    if (driveFolderResult) {
      driveFolderUrl = driveFolderResult.webViewLink;
      driveFolderId = driveFolderResult.folderId;
    }

    let initialDocs = [];
    if (req.files && req.files.length > 0) {
      for (let idx = 0; idx < req.files.length; idx++) {
        const f = req.files[idx];
        
        const driveFileUpload = await uploadFileToDriveFolder(req.user, driveFolderId, f.path, f.originalname, f.mimetype);
        
        // Always delete local temporary file
        fs.unlinkSync(f.path);

        if (!driveFileUpload) {
          return res.status(500).json({ success: false, error: 'Google Drive upload failed or is not configured. Files cannot be saved on this server.' });
        }

        initialDocs.push({
          id: 'DOC_' + Date.now() + '_' + idx,
          originalName: f.originalname,
          filename: f.filename,
          url: driveFileUpload.webViewLink,
          driveUrl: driveFileUpload.webViewLink,
          uploadedAt: new Date().toISOString(),
          uploadedBy: req.user.full_name || req.user.email
        });
      }
    }

    const savedExternalClients = await handleExternalClients(externalClients, projectId, req.user);

    const project = await Project.create({
      project_id: projectId,
      title: cleanTitle,
      description: description || '',
      business_entity: finalBiz,
      department: department || 'Operations',
      status: 'Active',
      priority: priority || 'Medium',
      project_lead: projectLead || null,
      start_date: startDate || null,
      due_date: dueDate || null,
      drive_folder_url: driveFolderUrl,
      documents: JSON.stringify(initialDocs),
      created_by: req.user.user_id,
      external_clients: savedExternalClients,
      telegram_chat_id: telegramChatId || null
    });

    return res.json({
      success: true,
      message: 'Project created successfully!',
      data: project
    });
  } catch (err) {
    console.error('Create project error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/projects/:id/upload — Add Document(s) to existing project
router.post('/:id/upload', authMiddleware, upload.any(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await Project.findOne({ where: { project_id: projectId } });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    let existingDocs = [];
    try {
      existingDocs = typeof project.documents === 'string' ? JSON.parse(project.documents || '[]') : (project.documents || []);
    } catch (e) {
      existingDocs = [];
    }

    const folderName = project.title.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
    const newDocs = [];

    if (req.files && req.files.length > 0) {
      for (let idx = 0; idx < req.files.length; idx++) {
        const f = req.files[idx];

        // Try to extract folder ID from drive_folder_url if possible, else upload to root
        let folderId = null;
        if (project.drive_folder_url) {
           const match = project.drive_folder_url.match(/folders\/([a-zA-Z0-9_-]+)/);
           if (match) folderId = match[1];
        }

        const driveFileUpload = await uploadFileToDriveFolder(req.user, folderId, f.path, f.originalname, f.mimetype);
        
        // Clean up local temp file
        fs.unlinkSync(f.path);

        if (!driveFileUpload) {
           return res.status(500).json({ success: false, error: 'Google Drive upload failed or is not configured. Files cannot be saved on this server.' });
        }

        newDocs.push({
          id: 'DOC_' + Date.now() + '_' + idx,
          originalName: f.originalname,
          filename: f.filename,
          url: driveFileUpload.webViewLink,
          driveUrl: driveFileUpload.webViewLink,
          uploadedAt: new Date().toISOString(),
          uploadedBy: req.user.full_name || req.user.email
        });
      }
    }

    const updatedDocs = [...existingDocs, ...newDocs];
    await project.update({ documents: JSON.stringify(updatedDocs) });

    return res.json({
      success: true,
      message: `${newDocs.length} document(s) uploaded successfully!`,
      documents: updatedDocs
    });
  } catch (err) {
    console.error('Upload document error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PUT /api/projects/:id — Update project details
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await Project.findOne({ where: { project_id: projectId } });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    const { title, description, businessEntity, department, status, priority, projectLead, startDate, dueDate, externalClients, telegramChatId } = req.body;
    const updateFields = {};
    if (title !== undefined) updateFields.title = title.trim();
    if (description !== undefined) updateFields.description = description;
    if (businessEntity !== undefined) updateFields.business_entity = businessEntity;
    if (department !== undefined) updateFields.department = department;
    if (status !== undefined) updateFields.status = status;
    if (priority !== undefined) updateFields.priority = priority;
    if (projectLead !== undefined) updateFields.project_lead = projectLead;
    if (startDate !== undefined) updateFields.start_date = startDate;
    if (dueDate !== undefined) updateFields.due_date = dueDate;
    
    if (externalClients !== undefined) {
      const savedExternalClients = await handleExternalClients(externalClients, projectId, req.user);
      updateFields.external_clients = savedExternalClients;
    }
    if (telegramChatId !== undefined) {
      updateFields.telegram_chat_id = telegramChatId || null;
    }

    await project.update(updateFields);

    return res.json({
      success: true,
      message: 'Project updated successfully!',
      data: project
    });
  } catch (err) {
    console.error('Update project error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. DELETE /api/projects/:id — Delete project
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await Project.findOne({ where: { project_id: projectId } });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    await project.destroy();
    return res.json({ success: true, message: 'Project deleted successfully' });
  } catch (err) {
    console.error('Delete project error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
