const express = require('express');
const router = express.Router();
const { AuditLog } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

// GET /api/audit-logs
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { entity_id, user_id, action, q } = req.query;
    
    let whereClause = {};

    // ── Workspace Isolation: Scope audit logs by business_entity ──
    const isSuper = ['SuperAdmin', 'Founder'].includes(req.user.role);
    if (!isSuper) {
      const userBizStr = req.user.business_entities || '';
      const userBizs = userBizStr.split(',').map(s => s.trim()).filter(Boolean);

      if (userBizs.length > 0) {
        const bizConditions = [];
        userBizs.forEach(b => {
          bizConditions.push({ business_entity: b });
          bizConditions.push({ business_entity: { [Op.like]: `%${b}%` } });
        });
        // Also include logs with no business_entity (legacy/untagged logs)
        bizConditions.push({ business_entity: null });
        bizConditions.push({ business_entity: '' });
        whereClause[Op.or] = bizConditions;
      }

      // Exclude SuperAdmin user activity from non-SuperAdmin views
      const { User } = require('../models');
      const superAdminUsers = await User.findAll({
        where: { role: { [Op.in]: ['SuperAdmin', 'Founder'] } },
        attributes: ['user_id']
      });
      const superAdminIds = superAdminUsers.map(u => u.user_id);
      if (superAdminIds.length > 0) {
        whereClause.user_id = { [Op.notIn]: superAdminIds };
      }
    }

    if (entity_id) {
      whereClause.entity_id = entity_id;
    }

    if (user_id && user_id !== 'all') {
      whereClause.user_id = user_id;
    }

    if (action && action !== 'all') {
      whereClause.action = action;
    }

    if (q) {
      whereClause[Op.and] = [
        ...(whereClause[Op.and] || []),
        {
          [Op.or]: [
            { details: { [Op.like]: `%${q}%` } },
            { action: { [Op.like]: `%${q}%` } }
          ]
        }
      ];
    }


    const logs = await AuditLog.findAll({
      where: whereClause,
      order: [['created_at', 'ASC']]
    });

    const userIds = [...new Set(logs.map(l => l.user_id))];
    const { User } = require('../models');
    const logUsers = await User.findAll({
      where: { user_id: userIds },
      attributes: ['user_id', 'full_name', 'email']
    });

    const userMap = {};
    logUsers.forEach(u => {
      userMap[u.user_id] = u.full_name || u.email;
    });

    const enrichedLogs = logs.map(l => {
      const plainLog = l.toJSON();
      plainLog.user_name = userMap[l.user_id] || l.user_id;
      return plainLog;
    });

    res.json({ success: true, data: enrichedLogs });

  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
