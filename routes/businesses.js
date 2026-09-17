const express = require('express');
const router = express.Router();
const { Business, User, Task, Department } = require('../models');
const { authMiddleware } = require('../middleware/auth');

// 1. GET /api/businesses — List business entities (scoped by Admin)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const isSuper = ['SuperAdmin', 'Founder'].includes(req.user.role);

    // 1. Fetch users and collect active (approved) user business entities & admin names
    const users = await User.findAll({ attributes: ['id', 'user_id', 'email', 'business_entities', 'full_name', 'role', 'status'] });
    const activeUsers = users.filter(u => u.status === 'Active');
    const activeBizSet = new Set();

    activeUsers.forEach(u => {
      const str = u.business_entities || '';
      if (str.trim()) {
        str.split(',').forEach(s => {
          const clean = s.trim().toLowerCase();
          if (clean) activeBizSet.add(clean);
        });
      } else if (u.role === 'Admin' && u.full_name && u.full_name.trim()) {
        const cleanName = u.full_name.trim();
        activeBizSet.add(cleanName.toLowerCase());
        // Auto-set business_entities for approved Admin if empty
        try {
          u.update({ business_entities: cleanName });
        } catch (uErr) {}
      }
    });

    // 2. Discover business entities from Tasks & Departments
    const discovered = new Set();

    activeUsers.forEach(u => {
      if (u.business_entities) {
        u.business_entities.split(',').forEach(s => {
          const clean = s.trim();
          if (clean) discovered.add(clean);
        });
      } else if (u.role === 'Admin' && u.full_name) {
        discovered.add(u.full_name.trim());
      }
    });

    try {
      const tasks = await Task.findAll({ attributes: ['business_entity'] });
      tasks.forEach(t => {
        const clean = (t.business_entity || '').trim();
        if (clean && activeBizSet.has(clean.toLowerCase())) discovered.add(clean);
      });
    } catch (e) {}

    try {
      const depts = await Department.findAll({ attributes: ['business_entity'] });
      depts.forEach(d => {
        const clean = (d.business_entity || '').trim();
        if (clean && activeBizSet.has(clean.toLowerCase())) discovered.add(clean);
      });
    } catch (e) {}

    // 3. Fetch existing Business records
    let allBiz = await Business.findAll({ order: [['created_at', 'DESC']] });
    const existingNames = new Set(allBiz.map(b => (b.name || '').trim().toLowerCase()));

    // Auto-create Business records for any discovered workspace name not yet in table
    for (const name of discovered) {
      if (name && !existingNames.has(name.toLowerCase())) {
        try {
          const newBiz = await Business.create({
            business_id: 'BIZ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
            name: name,
            description: 'Workspace entity',
            created_by: 'System',
            status: 'Active',
            form_builder_enabled: false
          });
          allBiz.unshift(newBiz);
          existingNames.add(name.toLowerCase());
        } catch (cErr) {}
      }
    }

    if (isSuper) {
      return res.json({ success: true, data: allBiz });
    }

    const userId = req.user?.user_id;
    const userEmail = req.user?.email;
    const userBizStr = req.user?.business_entities || '';
    const userAssignedBizs = userBizStr ? userBizStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

    const uIdLower = String(userId || '').trim().toLowerCase();
    const uEmailLower = String(userEmail || '').trim().toLowerCase();

    const scoped = allBiz.filter(b => {
      const bNameLower = (b.name || '').trim().toLowerCase();
      const bCreatorLower = String(b.created_by || '').trim().toLowerCase();

      const isCreator = Boolean(
        (uIdLower && bCreatorLower === uIdLower) ||
        (uEmailLower && bCreatorLower === uEmailLower)
      );
      const isAssigned = userAssignedBizs.includes(bNameLower);
      return isCreator || isAssigned;
    });

    return res.json({ success: true, data: scoped });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST /api/businesses — Create a new Business Entity (Company)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Company name is required' });
    }

    const cleanName = name.trim();

    // Check existing by name (case-insensitive)
    const allBiz = await Business.findAll();
    const existing = allBiz.find(b => (b.name || '').trim().toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      return res.status(400).json({ success: false, error: `Company "${cleanName}" already exists.` });
    }

    const creatorId = req.user?.user_id || req.user?.email || 'ADMIN';

    const newBiz = await Business.create({
      business_id: 'BIZ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      name: cleanName,
      description: description || '',
      created_by: creatorId,
      status: 'Active'
    });

    // Auto-append newly created company to Admin's business_entities list in DB
    try {
      if (req.user && req.user.update) {
        const currentBizStr = req.user.business_entities || '';
        const currentArr = currentBizStr.split(',').map(s => s.trim()).filter(Boolean);
        if (!currentArr.some(b => b.toLowerCase() === cleanName.toLowerCase())) {
          currentArr.push(cleanName);
          await req.user.update({ business_entities: currentArr.join(', ') });
        }
      }
    } catch (uErr) {
      console.error('Error updating user business_entities:', uErr.message);
    }

    return res.json({
      success: true,
      message: `Company "${newBiz.name}" created successfully!`,
      data: newBiz
    });
  } catch (err) {
    console.error('Error in POST /api/businesses:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. DELETE /api/businesses/:id — Delete a company
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const biz = await Business.findByPk(req.params.id);
    if (!biz) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    await biz.destroy();
    return res.json({ success: true, message: 'Company deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PUT /api/businesses/:id/telegram — Update Business Telegram Bot Token & Chat ID
router.put('/:id/telegram', authMiddleware, async (req, res) => {
  try {
    const { telegramBotToken, telegramChatId } = req.body;
    const biz = await Business.findByPk(req.params.id);
    if (!biz) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    const updates = {};
    if (telegramBotToken !== undefined) updates.telegram_bot_token = telegramBotToken || null;
    if (telegramChatId !== undefined) updates.telegram_chat_id = telegramChatId || null;

    await biz.update(updates);
    return res.json({
      success: true,
      message: `Telegram credentials saved for workspace "${biz.name}".`,
      data: {
        ...biz.toJSON(),
        telegramBotToken: biz.telegram_bot_token || '',
        telegramChatId: biz.telegram_chat_id || ''
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
