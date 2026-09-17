const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Project = sequelize.define('Project', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  project_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
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
    allowNull: true,
    defaultValue: 'Company X (Shared)'
  },
  department: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'Operations'
  },
  status: {
    type: DataTypes.ENUM('Planning', 'Active', 'On Hold', 'Completed', 'Archived'),
    defaultValue: 'Active'
  },
  priority: {
    type: DataTypes.ENUM('Low', 'Medium', 'High', 'Urgent'),
    defaultValue: 'Medium'
  },
  project_lead: {
    type: DataTypes.STRING,
    allowNull: true
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  due_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  drive_folder_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  documents: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]'
  },
  created_by: {
    type: DataTypes.STRING,
    allowNull: true
  },
  external_clients: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  telegram_chat_id: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'projects',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Project;
