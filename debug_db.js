const sequelize = require('./config/database');
const { DataTypes } = require('sequelize');

async function run() {
  try {
    await sequelize.authenticate();
    const [tasks] = await sequelize.query('SELECT task_id, title, assigned_to, created_by FROM tasks LIMIT 10');
    console.log("Tasks:", tasks);
    
    const [users] = await sequelize.query('SELECT user_id, email, full_name, role FROM users LIMIT 10');
    console.log("Users:", users);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
