const express = require('express');
const router = express.Router();
const { Meeting } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

// GET /api/meetings - Fetch meetings (Enforces STRICT multi-tenant company privacy)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { department, businessEntity } = req.query;
    const isSuper = ['SuperAdmin', 'Founder'].includes(req.user.role);
    const whereClause = {};

    // Multi-tenant Isolation: Non-SuperAdmin users ONLY see meetings for their assigned company or created by them
    if (!isSuper) {
      const userBizStr = req.user?.business_entities || '';
      const userBizs = userBizStr ? userBizStr.split(',').map(s => s.trim()).filter(Boolean) : [];

      const privacyConditions = [];

      if (req.user.full_name) privacyConditions.push({ created_by: req.user.full_name });
      if (req.user.user_id) privacyConditions.push({ created_by: req.user.user_id });
      if (req.user.email) privacyConditions.push({ created_by: req.user.email });

      if (userBizs.length > 0) {
        userBizs.forEach(b => {
          privacyConditions.push({ business_entity: b });
          privacyConditions.push({ business_entity: { [Op.like]: `%${b}%` } });
        });
      }

      if (privacyConditions.length > 0) {
        whereClause[Op.or] = privacyConditions;
      }
    }

    // Filter strictly by requested business entity if provided
    if (businessEntity && businessEntity !== 'ALL' && businessEntity.toLowerCase() !== 'all') {
      whereClause.business_entity = { [Op.like]: `%${businessEntity}%` };
    }

    if (department && department !== 'ALL' && department.toLowerCase() !== 'all') {
      whereClause.department = department;
    }

    const meetings = await Meeting.findAll({
      where: whereClause,
      order: [['date', 'ASC'], ['start_time', 'ASC']]
    });

    return res.json({ success: true, data: meetings });
  } catch (err) {
    console.error('Error fetching meetings:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/meetings - Schedule new Admin / Team meeting
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      title,
      date,
      startTime,
      endTime,
      attendees,
      locationLink,
      meetLink,
      relatedTo,
      notes,
      department,
      businessEntity
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: 'Meeting Title is required' });
    }

    const todayDateStr = new Date().toISOString().split('T')[0];
    const meetingDate = date || todayDateStr;
    const meetingStartTime = startTime || '10:00';

    const userFirstBiz = req.user?.business_entities ? req.user.business_entities.split(',')[0].trim() : null;
    const finalBiz = (businessEntity && businessEntity !== 'ALL' && businessEntity !== 'Company X (Shared)')
      ? businessEntity
      : (userFirstBiz || 'General');

    const meetingId = 'MTG-' + String(Math.floor(100 + Math.random() * 900));
    const newMeeting = await Meeting.create({
      meeting_id: meetingId,
      title: title.trim(),
      date: meetingDate,
      start_time: meetingStartTime,
      end_time: endTime || '',
      attendees: attendees ? (Array.isArray(attendees) ? attendees.join(', ') : attendees.trim()) : '',
      location_link: locationLink ? locationLink.trim() : '',
      meet_link: meetLink ? meetLink.trim() : '',
      related_to: relatedTo ? relatedTo.trim() : finalBiz,
      notes: notes ? notes.trim() : '',
      department: department || req.user?.department || 'Operations',
      business_entity: finalBiz,
      created_by: req.user ? (req.user.full_name || req.user.user_id || req.user.email) : 'Admin'
    });

    return res.json({
      success: true,
      message: 'Meeting scheduled successfully!',
      data: newMeeting
    });
  } catch (err) {
    console.error('Error creating meeting:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/meetings/:id - Edit an existing meeting
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id;
    const meeting = await Meeting.findOne({
      where: {
        [Op.or]: [
          { meeting_id: targetId },
          { id: targetId }
        ]
      }
    });

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const {
      title, date, startTime, endTime, attendees,
      locationLink, meetLink, relatedTo, notes, department, businessEntity
    } = req.body;

    if (title !== undefined) meeting.title = title.trim();
    if (date !== undefined) meeting.date = date;
    if (startTime !== undefined) meeting.start_time = startTime;
    if (endTime !== undefined) meeting.end_time = endTime;
    if (attendees !== undefined) meeting.attendees = Array.isArray(attendees) ? attendees.join(', ') : attendees;
    if (locationLink !== undefined) meeting.location_link = locationLink;
    if (meetLink !== undefined) meeting.meet_link = meetLink;
    if (relatedTo !== undefined) meeting.related_to = relatedTo;
    if (notes !== undefined) meeting.notes = notes;
    if (department !== undefined) meeting.department = department;
    if (businessEntity !== undefined) meeting.business_entity = businessEntity;

    await meeting.save();

    return res.json({ success: true, message: 'Meeting updated successfully', data: meeting });
  } catch (err) {
    console.error('Error updating meeting:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/meetings/:id - Delete a meeting
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id;
    const meeting = await Meeting.findOne({
      where: {
        [Op.or]: [
          { meeting_id: targetId },
          { id: targetId }
        ]
      }
    });

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    await meeting.destroy();
    return res.json({ success: true, message: 'Meeting deleted successfully' });
  } catch (err) {
    console.error('Error deleting meeting:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
