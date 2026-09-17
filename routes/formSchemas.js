const express = require('express');
const router = express.Router();
const { FormSchema, Business } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

const adminOnly = (req, res, next) => {
  const allowed = ['Admin', 'SuperAdmin', 'Founder'];
  if (req.user && allowed.includes(req.user.role)) return next();
  return res.status(403).json({ success: false, error: 'Admin access required' });
};

// GET /api/form-schemas/:businessEntity — Fetch schema for a workspace
router.get('/:businessEntity', authMiddleware, async (req, res) => {
  try {
    const ownerId = ['Admin', 'SuperAdmin', 'Founder'].includes(req.user.role)
      ? req.user.user_id
      : (req.user.approved_by || req.user.user_id);
    const formKey = `ACCOUNT_FORM_${ownerId}`;

    const schema = await FormSchema.findOne({
      where: { business_entity: formKey }
    });
    return res.json({ success: true, data: schema || null });
  } catch (err) {
    console.error('Error fetching form schema:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/form-schemas/:businessEntity — Save/Update schema (Admin only)
router.put('/:businessEntity', authMiddleware, adminOnly, async (req, res) => {
  try {
    const ownerId = ['Admin', 'SuperAdmin', 'Founder'].includes(req.user.role)
      ? req.user.user_id
      : (req.user.approved_by || req.user.user_id);
    const formKey = `ACCOUNT_FORM_${ownerId}`;
    
    const { schema } = req.body;

    if (!schema || !Array.isArray(schema.fields)) {
      return res.status(400).json({ success: false, error: 'Invalid schema: must have a fields array' });
    }

    let existing = await FormSchema.findOne({
      where: { business_entity: formKey }
    });

    if (existing) {
      existing.schema = schema;
      existing.created_by = req.user?.full_name || req.user?.email || 'Admin';
      await existing.save();
      return res.json({ success: true, message: 'Form schema updated', data: existing });
    } else {
      const newSchema = await FormSchema.create({
        schema_id: 'FORM_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        business_entity: formKey,
        schema,
        created_by: req.user?.full_name || req.user?.email || 'Admin'
      });
      return res.json({ success: true, message: 'Form schema created', data: newSchema });
    }
  } catch (err) {
    console.error('Error saving form schema:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/form-schemas/feature/:businessId — SuperAdmin toggle form_builder_enabled
router.patch('/feature/:businessId', authMiddleware, async (req, res) => {
  try {
    const isSuperAdmin = ['SuperAdmin', 'Founder'].includes(req.user?.role);
    if (!isSuperAdmin) return res.status(403).json({ success: false, error: 'SuperAdmin only' });

    const { enabled } = req.body;
    const biz = await Business.findOne({
      where: {
        [Op.or]: [
          { business_id: req.params.businessId },
          { id: req.params.businessId }
        ]
      }
    });
    if (!biz) return res.status(404).json({ success: false, error: 'Workspace not found' });

    await biz.update({ form_builder_enabled: Boolean(enabled) });
    return res.json({
      success: true,
      message: `Form Builder ${enabled ? 'enabled' : 'disabled'} for "${biz.name}"`,
      data: biz
    });
  } catch (err) {
    console.error('Error toggling form builder:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
