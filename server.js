const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { sequelize, User, Department } = require('./models');
const { ensureMysqlDatabase } = require('./lib/ensureMysql');

const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const departmentRoutes = require('./routes/departments');
const userRoutes = require('./routes/users');
const aiRoutes = require('./routes/ai');
const reportsRoutes = require('./routes/reports');

const commentRoutes = require('./routes/comments');
const projectRoutes = require('./routes/projects');
const superadminRoutes = require('./routes/superadmin');
const businessRoutes = require('./routes/businesses');
const actionPlanRoutes = require('./routes/actionPlans');
const meetingRoutes = require('./routes/meetings');
const auditLogRoutes = require('./routes/auditLogs');
const formSchemaRoutes = require('./routes/formSchemas');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/action-plans', actionPlanRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/form-schemas', formSchemaRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Database Sync & Server Startup
async function startServer() {
  const dialect = process.env.DB_DIALECT || 'mysql';
  if (dialect !== 'sqlite') {
    await ensureMysqlDatabase();
  }

  try {
    // Migration helper for MySQL table columns (Runs BEFORE sequelize.sync and queries)
    try {
      const queryInterface = sequelize.getQueryInterface();
      const userTableComp = await queryInterface.describeTable('users');

      if (!userTableComp.business_entities) {
        await queryInterface.addColumn('users', 'business_entities', {
          type: require('sequelize').DataTypes.TEXT,
          allowNull: true
        });
      }
      if (!userTableComp.is_password_set) {
        await queryInterface.addColumn('users', 'is_password_set', {
          type: require('sequelize').DataTypes.BOOLEAN,
          defaultValue: false
        });
      }
      if (!userTableComp.telegram_bot_token) {
        await queryInterface.addColumn('users', 'telegram_bot_token', {
          type: require('sequelize').DataTypes.TEXT,
          allowNull: true
        });
      }
      if (!userTableComp.telegram_chat_id) {
        await queryInterface.addColumn('users', 'telegram_chat_id', {
          type: require('sequelize').DataTypes.STRING,
          allowNull: true
        });
      }
      if (!userTableComp.approved_by) {
        await queryInterface.addColumn('users', 'approved_by', {
          type: require('sequelize').DataTypes.STRING,
          allowNull: true
        });
      }
      if (!userTableComp.google_calendar_url) {
        await queryInterface.addColumn('users', 'google_calendar_url', {
          type: require('sequelize').DataTypes.TEXT,
          allowNull: true
        });
      }
      if (!userTableComp.google_drive_parent_folder_id) {
        await queryInterface.addColumn('users', 'google_drive_parent_folder_id', {
          type: require('sequelize').DataTypes.STRING,
          allowNull: true
        });
      }
      if (!userTableComp.google_drive_credentials_json) {
        await queryInterface.addColumn('users', 'google_drive_credentials_json', {
          type: require('sequelize').DataTypes.TEXT,
          allowNull: true
        });
      }
      if (!userTableComp.google_drive_enabled) {
        await queryInterface.addColumn('users', 'google_drive_enabled', {
          type: require('sequelize').DataTypes.BOOLEAN,
          defaultValue: false
        });
      }
      if (!userTableComp.form_builder_enabled) {
        await queryInterface.addColumn('users', 'form_builder_enabled', {
          type: require('sequelize').DataTypes.BOOLEAN,
          defaultValue: false
        });
      }

      const deptTableComp = await queryInterface.describeTable('departments');
      if (!deptTableComp.telegram_bot_token) {
        await queryInterface.addColumn('departments', 'telegram_bot_token', {
          type: require('sequelize').DataTypes.STRING,
          allowNull: true
        });
      }
      if (!deptTableComp.business_entities) {
        await queryInterface.addColumn('departments', 'business_entities', {
          type: require('sequelize').DataTypes.TEXT,
          allowNull: true
        });
      }
      if (!deptTableComp.minutes_per_story_point) {
        await queryInterface.addColumn('departments', 'minutes_per_story_point', {
          type: require('sequelize').DataTypes.INTEGER,
          defaultValue: 60
        });
      }
      if (!deptTableComp.daily_working_hours) {
        await queryInterface.addColumn('departments', 'daily_working_hours', {
          type: require('sequelize').DataTypes.FLOAT,
          defaultValue: 8.0
        });
      }

      try {
        const bizTableComp = await queryInterface.describeTable('businesses');
        if (!bizTableComp.created_by) {
          await queryInterface.addColumn('businesses', 'created_by', {
            type: require('sequelize').DataTypes.STRING,
            allowNull: true
          });
        }
        if (!bizTableComp.telegram_bot_token) {
          await queryInterface.addColumn('businesses', 'telegram_bot_token', {
            type: require('sequelize').DataTypes.STRING,
            allowNull: true
          });
        }
        if (!bizTableComp.telegram_chat_id) {
          await queryInterface.addColumn('businesses', 'telegram_chat_id', {
            type: require('sequelize').DataTypes.STRING,
            allowNull: true
          });
        }
      } catch (bizErr) { }

      const taskTableComp = await queryInterface.describeTable('tasks');
      if (!taskTableComp.story_points) {
        await queryInterface.addColumn('tasks', 'story_points', {
          type: require('sequelize').DataTypes.DECIMAL(10, 2),
          defaultValue: 0.00
        });
      }
      
      if (!taskTableComp.seen_at) {
        await queryInterface.addColumn('tasks', 'seen_at', { type: require('sequelize').DataTypes.DATE, allowNull: true });
      }
      if (!taskTableComp.working_at) {
        await queryInterface.addColumn('tasks', 'working_at', { type: require('sequelize').DataTypes.DATE, allowNull: true });
      }
      if (!taskTableComp.done_at) {
        await queryInterface.addColumn('tasks', 'done_at', { type: require('sequelize').DataTypes.DATE, allowNull: true });
      }
      if (!taskTableComp.closed_at) {
        await queryInterface.addColumn('tasks', 'closed_at', { type: require('sequelize').DataTypes.DATE, allowNull: true });
      }
      if (!taskTableComp.project_id) {
        await queryInterface.addColumn('tasks', 'project_id', {
          type: require('sequelize').DataTypes.STRING,
          allowNull: true
        });
      }
      try {
        await sequelize.query("ALTER TABLE `tasks` MODIFY COLUMN `priority` VARCHAR(32) DEFAULT 'Normal';");
      } catch (pColErr) { }

      const labCols = {
        case_type: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        patient_name: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        tooth_numbers: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        shade: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        approval_status: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        rejection_reason: { type: require('sequelize').DataTypes.TEXT, allowNull: true },
        lab_stage: { type: require('sequelize').DataTypes.INTEGER, defaultValue: 0 },
        form_date: { type: require('sequelize').DataTypes.DATEONLY, allowNull: true },
        doctor_name: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        hospital_name: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        patient_age: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        patient_sex: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        work_types: { type: require('sequelize').DataTypes.TEXT, allowNull: true },
        work_other: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        contact_point: { type: require('sequelize').DataTypes.STRING, allowNull: true },
        metal_try_in: { type: require('sequelize').DataTypes.DATEONLY, allowNull: true },
        unglazed_try_in: { type: require('sequelize').DataTypes.DATEONLY, allowNull: true },
        enclosures: { type: require('sequelize').DataTypes.TEXT, allowNull: true },
        signature_name: { type: require('sequelize').DataTypes.STRING, allowNull: true }
      };
      for (const [col, def] of Object.entries(labCols)) {
        if (!taskTableComp[col]) {
          await queryInterface.addColumn('tasks', col, def);
        }
      }
    } catch (migErr) {
      console.log('Migration check:', migErr.message);
    }

    try {
      await sequelize.sync({ alter: true });
      console.log('✅ Database models synced & altered successfully.');
    } catch (syncErr) {
      console.log('⚠️ Notice: alter sync failed, proceeding with standard sync:', syncErr.message);
      await sequelize.sync();
      console.log('✅ Database models synced successfully.');
    }

    // Perform initial batch sync of Completed tasks to Action Plans
    try {
      const { Task, ActionPlan } = require('./models');
      const completedTasks = await Task.findAll({
        where: {
          status: ['Completed', 'Done', 'Completed', 'done', 'completed']
        }
      });
      if (completedTasks.length > 0) {
        const cleanStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const plans = await ActionPlan.findAll();

        for (const taskRecord of completedTasks) {
          const taskClean = cleanStr(taskRecord.title);
          const taskTitleLower = String(taskRecord.title || '').trim().toLowerCase();

          for (const plan of plans) {
            let currentStructure = plan.structure;
            if (typeof currentStructure === 'string') {
              try { currentStructure = JSON.parse(currentStructure); } catch (e) { currentStructure = []; }
            }
            if (!Array.isArray(currentStructure)) continue;

            let planUpdated = false;
            const newStructure = currentStructure.map(pillar => ({
              ...pillar,
              subheadings: (pillar.subheadings || []).map(sub => ({
                ...sub,
                tasks: (sub.tasks || []).map(t => {
                  const tTitleLower = String(t.title || '').trim().toLowerCase();
                  const tClean = cleanStr(t.title);
                  const matchesExact = tTitleLower && (tTitleLower === taskTitleLower);
                  const matchesClean = tClean && taskClean && (tClean === taskClean || tClean.includes(taskClean) || taskClean.includes(tClean));

                  if ((matchesExact || matchesClean) && !t.completed) {
                    planUpdated = true;
                    return { ...t, completed: true };
                  }
                  return t;
                })
              }))
            }));

            if (planUpdated) {
              plan.structure = newStructure;
              plan.changed('structure', true);
              await plan.save();
              console.log(`[Auto-Sync] ✅ Marked Action Plan task "${taskRecord.title}" as completed.`);
            }
          }
        }
      }

      // Cleanup: Remove any dummy Action Plan Main Task containers (TSK_AP_MAIN_*) so only assigned action items appear on board
      const { Op } = require('sequelize');
      try {
        const deletedMainTasks = await Task.destroy({
          where: {
            [Op.or]: [
              { task_id: { [Op.like]: 'TSK_AP_MAIN_%' } },
              { description: { [Op.like]: '%[AP_MAIN:%' } }
            ]
          }
        });
        if (deletedMainTasks > 0) {
          console.log(`🧹 Cleaned up ${deletedMainTasks} Action Plan dummy Main Tasks from board.`);
        }

        // Ensure all action plan assigned subtasks are standalone tasks
        await Task.update(
          { parent_task_id: null },
          {
            where: {
              description: { [Op.like]: '%[AP:%' },
              parent_task_id: { [Op.like]: 'TSK_AP_MAIN_%' }
            }
          }
        );
      } catch (cleanErr) {
        console.error('AP main task cleanup error:', cleanErr.message);
      }

      // Retrofix: Ensure all tasks without business_entity derive business_entity from Project, Assignee, Department, or Default
      const { Project, User, Department } = require('./models');
      const nullBizTasks = await Task.findAll({
        where: {
          [Op.or]: [
            { business_entity: null },
            { business_entity: '' }
          ]
        }
      });

      for (const t of nullBizTasks) {
        let inferredBiz = null;
        if (t.project_id) {
          const proj = await Project.findOne({ where: { project_id: t.project_id } });
          if (proj && proj.business_entity) inferredBiz = proj.business_entity;
        }
        if (!inferredBiz && t.assigned_to) {
          const firstAssignee = String(t.assigned_to).split(',')[0].trim();
          const u = await User.findOne({
            where: {
              [Op.or]: [
                { user_id: firstAssignee },
                { full_name: firstAssignee },
                { email: firstAssignee }
              ]
            }
          });
          if (u && u.business_entities) inferredBiz = u.business_entities.split(',')[0].trim();
        }
        if (!inferredBiz && t.department) {
          const firstDept = String(t.department).split(',')[0].trim();
          const d = await Department.findOne({
            where: {
              [Op.or]: [
                { department_id: firstDept },
                { name: firstDept }
              ]
            }
          });
          if (d && d.business_entities) inferredBiz = d.business_entities.split(',')[0].trim();
        }
        if (inferredBiz) {
          await t.update({ business_entity: inferredBiz });
        }
      }
    } catch (syncBatchErr) {
      console.error('Batch sync error:', syncBatchErr.message);
    }

    // Auto-create/verify SuperAdmin account superadmin@gmail.com (password: admin123)
    const bcrypt = require('bcryptjs');
    const superPasswordHash = await bcrypt.hash('admin123', 10);
    let superAdminUser = await User.findOne({ where: { email: 'superadmin@gmail.com' } });
    if (!superAdminUser) {
      await User.create({
        user_id: 'USR_SUPERADMIN',
        email: 'superadmin@gmail.com',
        password_hash: superPasswordHash,
        full_name: 'Super Admin Master',
        role: 'SuperAdmin',
        department: 'Management',
        is_password_set: true,
        status: 'Active'
      });
      console.log('👑 Auto-created SuperAdmin account superadmin@gmail.com (password: admin123)');
    } else {
      await superAdminUser.update({
        role: 'SuperAdmin',
        password_hash: superPasswordHash,
        is_password_set: true,
        status: 'Active'
      });
      console.log('👑 Verified SuperAdmin account superadmin@gmail.com (password: admin123)');
    }



    const server = app.listen(PORT, () => {
      console.log(`🚀 Task Management Express Server running on http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} is currently occupied by another process.`);
      } else {
        console.error('Server error:', err);
      }
    });
  } catch (err) {
    console.error('❌ Database Sync Error:', err);
  }
}

startServer();
