const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Task = sequelize.define('Task', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  task_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  parent_task_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  main_heading: {
    type: DataTypes.ENUM('Documentation', 'Operations', 'Marketing', 'Revenue', 'Tech'),
    defaultValue: 'Operations'
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  business_entity: {
    type: DataTypes.STRING,
    defaultValue: 'Company X (Shared)'
  },
  department: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Operations'
  },
  priority: {
    type: DataTypes.STRING,
    defaultValue: 'Normal'
  },
  assigned_to: {
    type: DataTypes.STRING,
    allowNull: true
  },
  assigned_by: {
    type: DataTypes.STRING,
    allowNull: true
  },
  document_links: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  days_allowed: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  due_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  completion_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  pace_status: {
    type: DataTypes.ENUM('On Time', 'Delayed', 'Ahead'),
    defaultValue: 'On Time'
  },
  days_early_late: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('Not Started', 'In Progress', 'In Review', 'Stuck/Blocked', 'Completed'),
    defaultValue: 'Not Started'
  },
  estimated_budget: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00
  },
  actual_expense: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  story_points: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00
  },
  project_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  created_by: {
    type: DataTypes.STRING,
    allowNull: true
  },
  seen_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  working_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  done_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  case_type: {
    type: DataTypes.STRING,
    allowNull: true
  },
  patient_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  tooth_numbers: {
    type: DataTypes.STRING,
    allowNull: true
  },
  shade: {
    type: DataTypes.STRING,
    allowNull: true
  },
  approval_status: {
    type: DataTypes.STRING,
    allowNull: true
  },
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  lab_stage: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  form_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  doctor_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  hospital_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  patient_age: {
    type: DataTypes.STRING,
    allowNull: true
  },
  patient_sex: {
    type: DataTypes.STRING,
    allowNull: true
  },
  work_types: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  work_other: {
    type: DataTypes.STRING,
    allowNull: true
  },
  contact_point: {
    type: DataTypes.STRING,
    allowNull: true
  },
  metal_try_in: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  unglazed_try_in: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  enclosures: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  signature_name: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'tasks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Task;
