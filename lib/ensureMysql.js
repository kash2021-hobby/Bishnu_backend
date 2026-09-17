const mysql = require('mysql2/promise');

function mysqlConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    dbName: process.env.DB_NAME || 'bishnu_lab'
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Connects to the MySQL server (no database required) and creates
// the app database if it does not already exist.
async function ensureMysqlDatabase() {
  const { host, port, user, password, dbName } = mysqlConfig();
  const maxAttempts = 15;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let connection;
    try {
      connection = await mysql.createConnection({
        host,
        port,
        user,
        password
      });

      await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      await connection.end();
      console.log(`✅ MySQL database "${dbName}" is ready (created automatically if missing).`);
      return dbName;
    } catch (err) {
      lastError = err;
      if (connection) {
        try { await connection.end(); } catch (_) { /* ignore */ }
      }
      console.log(`⏳ Waiting for MySQL (${attempt}/${maxAttempts}): ${err.message}`);
      await sleep(2000);
    }
  }

  throw new Error(
    `Could not create MySQL database "${dbName}". Make sure MySQL is running and DB_USER / DB_PASS in .env can connect. Last error: ${lastError?.message || 'unknown'}`
  );
}

module.exports = { ensureMysqlDatabase, mysqlConfig };
