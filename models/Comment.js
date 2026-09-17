const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Comment = sequelize.define('Comment', {
  comment_id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  task_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  author_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  author_name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  comment_text: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  tagged_users: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  document_url: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  document_name: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'comments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Comment;
