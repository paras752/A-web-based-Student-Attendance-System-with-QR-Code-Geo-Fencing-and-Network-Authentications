/**
 * Forward-only schema migrations.
 *
 * schema.sql DROPs every table before recreating it, so `db:init` is a factory reset - fine
 * on an empty machine, catastrophic once there are real accounts, courses and attendance
 * records in the database. This runner is the non-destructive path: each file in
 * ./migrations is applied exactly once, in filename order, and recorded in
 * schema_migrations so re-running is a no-op.
 *
 * Usage:
 *   npm run db:migrate          apply everything pending
 *   npm run db:migrate:status   list applied/pending without changing anything
 *
 * A note on atomicity: MySQL and MariaDB both commit implicitly on DDL, so a migration
 * cannot be wrapped in a transaction. The runner therefore executes one statement at a time
 * and reports exactly which one failed; a failed migration is NOT recorded, so you fix the
 * file and re-run. Keep each migration small enough that a partial application is obvious.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(255) NOT NULL PRIMARY KEY,
    checksum    CHAR(64)     NOT NULL,
    applied_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB
`;

function readMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      return {
        version: file.replace(/\.sql$/, ''),
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

// Splits a migration into individual statements. Deliberately simple: it strips `--` line
// comments and splits on `;`, which is safe for the DDL these files contain but would break
// on a semicolon inside a string literal or a stored-routine body. If a migration ever needs
// either, give it its own DELIMITER-aware handling rather than loosening this.
function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getApplied(connection) {
  await connection.query(CREATE_TABLE_SQL);
  const [rows] = await connection.query('SELECT version, checksum, applied_at FROM schema_migrations');
  return new Map(rows.map((r) => [r.version, r]));
}

async function status() {
  const connection = await pool.getConnection();
  try {
    const applied = await getApplied(connection);
    const migrations = readMigrations();

    console.log(`\n${migrations.length} migration file(s) in ${path.relative(process.cwd(), MIGRATIONS_DIR)}\n`);
    for (const m of migrations) {
      const record = applied.get(m.version);
      if (!record) {
        console.log(`  PENDING   ${m.version}`);
      } else if (record.checksum !== m.checksum) {
        // An applied migration whose file has since changed means the database and the repo
        // disagree about what the schema is. Editing history is never the fix - add a new
        // migration instead.
        console.log(`  CHANGED!  ${m.version}  (applied ${record.applied_at.toISOString()}, file has been edited since)`);
      } else {
        console.log(`  applied   ${m.version}  ${record.applied_at.toISOString()}`);
      }
    }

    const orphaned = [...applied.keys()].filter((v) => !migrations.some((m) => m.version === v));
    for (const v of orphaned) {
      console.log(`  ORPHAN    ${v}  (recorded in the database but the file is gone)`);
    }
    console.log('');
  } finally {
    connection.release();
  }
}

async function migrate() {
  const connection = await pool.getConnection();
  try {
    const applied = await getApplied(connection);
    const migrations = readMigrations();

    const drifted = migrations.filter((m) => applied.has(m.version) && applied.get(m.version).checksum !== m.checksum);
    if (drifted.length > 0) {
      throw new Error(
        `These migrations were already applied but their files have changed: ${drifted
          .map((m) => m.version)
          .join(', ')}. Applied migrations are immutable - add a new migration instead.`
      );
    }

    const pending = migrations.filter((m) => !applied.has(m.version));
    if (pending.length === 0) {
      console.log('Database is up to date; nothing to apply.');
      return;
    }

    for (const m of pending) {
      const statements = splitStatements(m.sql);
      console.log(`Applying ${m.version} (${statements.length} statement(s)) ...`);
      for (const [i, statement] of statements.entries()) {
        try {
          await connection.query(statement);
        } catch (err) {
          throw new Error(
            `${m.version} failed on statement ${i + 1}/${statements.length}:\n\n${statement}\n\n${err.message}`
          );
        }
      }
      await connection.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [
        m.version,
        m.checksum,
      ]);
      console.log(`  ok  ${m.version}`);
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    connection.release();
  }
}

// Used by db:init: a freshly created database already matches every migration, so record
// them as applied rather than letting the runner try to re-add columns that schema.sql
// created.
async function markAllApplied(connection) {
  await connection.query(CREATE_TABLE_SQL);
  for (const m of readMigrations()) {
    await connection.query(
      'INSERT INTO schema_migrations (version, checksum) VALUES (?, ?) ON DUPLICATE KEY UPDATE checksum = VALUES(checksum)',
      [m.version, m.checksum]
    );
  }
}

module.exports = { migrate, status, markAllApplied, readMigrations };

if (require.main === module) {
  const command = process.argv[2] === 'status' ? status : migrate;
  command()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(`\nMigration failed:\n${err.message}\n`);
      await pool.end();
      process.exitCode = 1;
    });
}
