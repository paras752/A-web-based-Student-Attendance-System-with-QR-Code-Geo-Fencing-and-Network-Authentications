const mysql = require('mysql2/promise');
const env = require('./env');

// DATETIME columns (sessions.start_time/end_time, attendance_records.submitted_at via
// TIMESTAMP) are meaningless without a fixed timezone convention. The app always works in
// UTC (JS Date.toISOString()), so every connection in the pool is pinned to the UTC session
// timezone: this makes MySQL's NOW()/CURRENT_TIMESTAMP return the same instant a JS `new
// Date()` would, and makes mysql2's own Date<->DATETIME formatting (`timezone: 'Z'`)
// consistent regardless of what timezone the MySQL server itself is configured for.
const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  // Managed MySQL providers require TLS; undefined for a local XAMPP server, which has none.
  ...(env.db.ssl ? { ssl: env.db.ssl } : {}),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  timezone: 'Z',
});

pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

module.exports = pool;
