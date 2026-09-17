const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { User } = require('../models');
const { Op } = require('sequelize');

/**
 * Get authenticated Google Drive client for a specific Admin user.
 * Supports Service Account JSON or OAuth2 client credentials.
 */
function getDriveClientForAdmin(adminUser) {
  if (!adminUser || !adminUser.google_drive_credentials_json) {
    return null;
  }

  // Check enabled status (default true if credentials exist)
  if (adminUser.google_drive_enabled === false) {
    return null;
  }

  try {
    let credentials = typeof adminUser.google_drive_credentials_json === 'string'
      ? JSON.parse(adminUser.google_drive_credentials_json)
      : adminUser.google_drive_credentials_json;

    // Check if it's a Service Account key (contains client_email and private_key)
    if (credentials.client_email && credentials.private_key) {
      const formattedKey = credentials.private_key.replace(/\\n/g, '\n');
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: formattedKey,
        scopes: ['https://www.googleapis.com/auth/drive']
      });
      return { drive: google.drive({ version: 'v3', auth }), type: 'service_account', credentials };
    }

    // Check if it's an OAuth2 Refresh Token setup
    if (credentials.client_id && credentials.client_secret && credentials.refresh_token) {
      const auth = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret
      );
      auth.setCredentials({ refresh_token: credentials.refresh_token });
      return { drive: google.drive({ version: 'v3', auth }), type: 'oauth2', credentials };
    }

    console.warn(`[Drive Service] Invalid credentials structure for Admin "${adminUser.email}"`);
    return null;
  } catch (err) {
    console.error(`[Drive Service] Error parsing credentials for Admin "${adminUser.email}":`, err.message);
    return null;
  }
}

/**
 * Resolve the Admin owner object for a given user or task/project creator
 */
async function resolveAdminUser(userOrId) {
  if (!userOrId) return null;
  
  const userId = typeof userOrId === 'object' ? (userOrId.approved_by || userOrId.user_id || userOrId.email) : userOrId;

  // Always fetch fresh User from DB to ensure latest Google Drive fields are present
  let admin = await User.findOne({
    where: {
      [Op.or]: [
        { user_id: String(userId) },
        { email: String(userId).trim().toLowerCase() }
      ]
    }
  });

  if (!admin && typeof userOrId === 'object' && ['Admin', 'SuperAdmin', 'Founder'].includes(userOrId.role)) {
    admin = userOrId;
  }

  return admin;
}

/**
 * Automatically create a dedicated Google Drive folder for a Project.
 */
async function createProjectDriveFolder(userOrAdmin, projectName) {
  try {
    const adminUser = await resolveAdminUser(userOrAdmin);
    const driveObj = getDriveClientForAdmin(adminUser);
    
    if (!driveObj) {
      console.log(`[Drive Service] ℹ️ Google Drive integration not configured or disabled for Admin.`);
      return null;
    }

    const { drive } = driveObj;
    const parentFolderId = adminUser.google_drive_parent_folder_id;

    const fileMetadata = {
      name: projectName,
      mimeType: 'application/vnd.google-apps.folder'
    };

    if (parentFolderId && parentFolderId.trim()) {
      fileMetadata.parents = [parentFolderId.trim()];
    }

    const folderRes = await drive.files.create({
      requestBody: fileMetadata,
      supportsAllDrives: true,
      supportsTeamDrives: true,
      fields: 'id, webViewLink'
    });

    const folderId = folderRes.data.id;
    const webViewLink = folderRes.data.webViewLink;

    // Grant Anyone with link Reader permission
    try {
      await drive.permissions.create({
        fileId: folderId,
        supportsAllDrives: true,
        supportsTeamDrives: true,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
    } catch (permErr) {
      console.warn('[Drive Service] Could not set folder public reader permissions:', permErr.message);
    }

    console.log(`[Drive Service] ✅ Created Google Drive folder "${projectName}" (ID: ${folderId}) for Admin ${adminUser.email}`);
    return { folderId, webViewLink };
  } catch (err) {
    console.error('[Drive Service] Error creating Google Drive folder:', err.message);
    return null;
  }
}

/**
 * Upload a file directly into a Google Drive Folder.
 */
async function uploadFileToDriveFolder(userOrAdmin, folderId, filePath, originalName, mimeType) {
  try {
    const adminUser = await resolveAdminUser(userOrAdmin);
    const driveObj = getDriveClientForAdmin(adminUser);

    if (!driveObj) {
      return null;
    }

    const { drive } = driveObj;
    const targetFolderId = folderId || adminUser.google_drive_parent_folder_id;

    const fileMetadata = {
      name: originalName
    };
    if (targetFolderId && targetFolderId.trim()) {
      fileMetadata.parents = [targetFolderId.trim()];
    }

    const media = {
      mimeType: mimeType || 'application/octet-stream',
      body: fs.createReadStream(filePath)
    };

    const fileRes = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      supportsAllDrives: true,
      supportsTeamDrives: true,
      fields: 'id, webViewLink, webContentLink'
    });

    const uploadedFileId = fileRes.data.id;
    const webViewLink = fileRes.data.webViewLink;

    // Grant Anyone with link Reader permission
    try {
      await drive.permissions.create({
        fileId: uploadedFileId,
        supportsAllDrives: true,
        supportsTeamDrives: true,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
    } catch (permErr) {
      console.warn('[Drive Service] Could not set file public reader permissions:', permErr.message);
    }

    console.log(`[Drive Service] ✅ Uploaded file "${originalName}" to Google Drive (ID: ${uploadedFileId})`);
    return { fileId: uploadedFileId, webViewLink, webContentLink: fileRes.data.webContentLink };
  } catch (err) {
    console.error('[Drive Service] Error uploading file to Google Drive:', err.message);
    return null;
  }
}

module.exports = {
  getDriveClientForAdmin,
  createProjectDriveFolder,
  uploadFileToDriveFolder
};
