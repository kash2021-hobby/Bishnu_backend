const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Meeting = sequelize.define('Meeting', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  meeting_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  date: {
    type: DataTypes.STRING, // e.g. "2026-08-01"
    allowNull: true
  },
  start_time: {
    type: DataTypes.STRING, // e.g. "21:00"
    allowNull: true
  },
  end_time: {
    type: DataTypes.STRING, // e.g. "22:00"
    allowNull: true
  },
  attendees: {
    type: DataTypes.STRING, // e.g. "NAN, JUB, AZI, ASI"
    allowNull: true
  },
  location_link: {
    type: DataTypes.STRING, // e.g. "Google meet" or "CCD, Beltola"
    allowNull: true
  },
  related_to: {
    type: DataTypes.STRING, // e.g. "Evolution NetworX"
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT, // Agenda / Notes
    allowNull: true
  },
  department: {
    type: DataTypes.STRING,
    allowNull: true
  },
  business_entity: {
    type: DataTypes.STRING,
    allowNull: true
  },
  created_by: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  tableName: 'meetings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Meeting;
