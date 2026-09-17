const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FormSchema = sequelize.define('FormSchema', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  schema_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  business_entity: {
    type: DataTypes.STRING,
    allowNull: false
  },
  schema: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('schema');
      try { return raw ? JSON.parse(raw) : { fields: [] }; } catch { return { fields: [] }; }
    },
    set(val) {
      this.setDataValue('schema', typeof val === 'string' ? val : JSON.stringify(val));
    }
  },
  created_by: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'form_schemas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = FormSchema;
