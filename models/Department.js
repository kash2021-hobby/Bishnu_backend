const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Department = sequelize.define('Department', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  department_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  business_entities: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  admin_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  admin_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  admin_email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  icon: {
    type: DataTypes.STRING,
    defaultValue: '🏢'
  },
  color: {
    type: DataTypes.STRING,
    defaultValue: '#8b5cf6'
  },
  telegram_chat_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  telegram_bot_token: {
    type: DataTypes.STRING,
    allowNull: true
  },
  minutes_per_story_point: {
    type: DataTypes.INTEGER,
    defaultValue: 60
  },
  daily_working_hours: {
    type: DataTypes.FLOAT,
    defaultValue: 8.0
  },
  status: {
    type: DataTypes.ENUM('Active', 'Inactive'),
    defaultValue: 'Active'
  }
}, {
  tableName: 'departments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Department;
