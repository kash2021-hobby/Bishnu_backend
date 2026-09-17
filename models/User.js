const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password_hash: {
    type: DataTypes.STRING,
    allowNull: false
  },
  full_name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('SuperAdmin', 'Founder', 'Admin', 'DeptAdmin', 'TeamMember', 'Client'),
    defaultValue: 'TeamMember'
  },
  client_project_ids: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  department_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  department: {
    type: DataTypes.STRING,
    allowNull: true
  },
  business_entities: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('Active', 'Pending', 'Disabled', 'Inactive'),
    defaultValue: 'Active'
  },
  approved_by: {
    type: DataTypes.STRING,
    allowNull: true
  },
  google_calendar_url: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  is_password_set: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  telegram_bot_token: {
    type: DataTypes.STRING,
    allowNull: true
  },
  telegram_chat_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  google_drive_parent_folder_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  google_drive_credentials_json: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  google_drive_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  form_builder_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = User;
