const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ActionPlan = sequelize.define('ActionPlan', {
  plan_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  project_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Project Action Plan'
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  duration_days: {
    type: DataTypes.INTEGER,
    defaultValue: 180
  },
  checkpoint_days: {
    type: DataTypes.INTEGER,
    defaultValue: 60
  },
  // JSON structure containing array of pillars (main headings), subheadings, and tasks
  structure: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() {
      const raw = this.getDataValue('structure');
      if (!raw) return [];
      try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        return [];
      }
    },
    set(val) {
      this.setDataValue('structure', typeof val === 'string' ? val : JSON.stringify(val));
    }
  },
  is_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  created_by: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'action_plans',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = ActionPlan;
