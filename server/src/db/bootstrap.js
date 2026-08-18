const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');
const { markAllApplied } = require('./migrate');

/**
 * Creates the schema on a database that has no tables at all.
 *
 * A managed database is handed over empty, and the migrations are forward-only ALTERs, so on a
 * first deploy they fail with "Table 'x.refresh_tokens' doesn't exist" and the container
 * crash-loops until somebody runs db:init by hand. That is a poor first run and an error
 * message that does not say what to do about it.
 *
 * This is not db:init. It only ever runs when the database contains ZERO tables, so there is
 * nothing it could destroy - the reason db:init is dangerous is that it DROPs, and a database
 * with no tables has nothing to drop. It also seeds no accounts: the demo logins share a
 * password published in the README, and creating them on a public deployment would hand out
 * three working accounts, one of them an administrator.
 */
async function bootstrapIfEmpty() {
  // Its own connection: schema.sql is a multi-statement script, and the application pool
  // deliberately does not enable multipleStatements - that flag turns any future SQL-injection
  // slip into an arbitrary-statement execution.
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
    ...(env.db.ssl ? { ssl: env.db.ssl } : {}),
  });

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${env.db.database}\``);

    const [[{ tables }]] = await conn.query(
      'SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = ?',
      [env.db.database]
    );
    if (tables > 0) return false;

    console.log(`[bootstrap] '${env.db.database}' is empty - creating schema (no demo accounts)`);
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await conn.query(schemaSql);

    // schema.sql is kept in step with the migrations, so a database built from it is already at
    // the latest version. Recording that stops db:migrate from re-adding what it just created.
    await markAllApplied(conn);

    console.log('[bootstrap] schema created. Create the first administrator with:');
    console.log('[bootstrap]   npm run admin:create -- --email you@college.edu --name "Your Name"');
    return true;
  } finally {
    await conn.end();
  }
}

module.exports = { bootstrapIfEmpty };
