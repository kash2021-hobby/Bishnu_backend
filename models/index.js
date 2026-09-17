const sequelize = require('../config/database');
const User = require('./User');
const Department = require('./Department');
const Task = require('./Task');
const Business = require('./Business');
const Notification = require('./Notification');
const AuditLog = require('./AuditLog');
const Comment = require('./Comment');
const Project = require('./Project');
const ActionPlan = require('./ActionPlan');
const Meeting = require('./Meeting');
const FormSchema = require('./FormSchema');

// Define Relationships
Task.hasMany(Task, {
  foreignKey: 'parent_task_id',
  sourceKey: 'task_id',
  as: 'Subtasks'
});

Task.belongsTo(Task, {
  foreignKey: 'parent_task_id',
  targetKey: 'task_id',
  as: 'ParentTask'
});

Task.hasMany(Comment, {
  foreignKey: 'task_id',
  sourceKey: 'task_id',
  as: 'Comments'
});

Comment.belongsTo(Task, {
  foreignKey: 'task_id',
  targetKey: 'task_id',
  as: 'TaskDetails'
});

User.belongsTo(Department, {
  foreignKey: 'department_id',
  targetKey: 'department_id',
  as: 'DeptDetails'
});

Project.hasMany(Task, {
  foreignKey: 'project_id',
  sourceKey: 'project_id',
  as: 'Tasks'
});

Task.belongsTo(Project, {
  foreignKey: 'project_id',
  targetKey: 'project_id',
  as: 'Project'
});

Project.hasMany(ActionPlan, {
  foreignKey: 'project_id',
  sourceKey: 'project_id',
  as: 'ActionPlans',
  constraints: false
});

ActionPlan.belongsTo(Project, {
  foreignKey: 'project_id',
  targetKey: 'project_id',
  as: 'Project',
  constraints: false
});

module.exports = {
  sequelize,
  User,
  Department,
  Task,
  Business,
  Notification,
  AuditLog,
  Comment,
  Project,
  ActionPlan,
  Meeting,
  FormSchema
};
