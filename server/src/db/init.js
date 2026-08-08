/**
 * Creates the ssas database + schema, then seeds one account of each role plus
 * a demo course/enrolment so the API can be smoke-tested immediately.
 * Usage: npm run db:init   (from /server)
 *
 * This is a FACTORY RESET: schema.sql drops every table. To change the schema of a database
 * that already holds real accounts and attendance records, add a file under ./migrations and
 * run `npm run db:migrate` instead.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const env = require('../config/env');
const { markAllApplied } = require('./migrate');

const SEED_PASSWORD = 'Password123!';

// Nothing about `npm run db:init` hints that it destroys data, and the two commands sit one
// keystroke apart in package.json. Anything already in the database has to be an explicit,
// typed-out decision.
async function assertSafeToWipe(connection) {
  if (process.argv.includes('--force')) {
    console.log('--force given: existing data will be destroyed.\n');
    return;
  }

  let users;
  try {
    [[{ users }]] = await connection.query('SELECT COUNT(*) AS users FROM users');
  } catch (err) {
    // No database, no database selected, or no users table: all mean a first run.
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_DB_ERROR', 'ER_NO_DB_ERROR'].includes(err.code)) return;
    throw err;
  }
  if (users === 0) return;

  const [[counts]] = await connection.query(
    `SELECT (SELECT COUNT(*) FROM courses)            AS courses,
            (SELECT COUNT(*) FROM sessions)           AS sessions,
            (SELECT COUNT(*) FROM attendance_records) AS attendance`
  );

  const refusal = new Error(
    `Refusing to run: '${env.db.database}' already contains data ` +
      `(${users} users, ${counts.courses} courses, ${counts.sessions} sessions, ` +
      `${counts.attendance} attendance records).\n\n` +
      `db:init DROPS every table. If you meant to change the schema without losing data, ` +
      `add a migration and run:  npm run db:migrate\n` +
      `If you really do want to erase all of it, re-run with:  npm run db:init -- --force`
  );
  refusal.expected = true; // a deliberate stop, not a crash - no stack trace needed
  throw refusal;
}

async function run() {
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  // Connect with no database selected, then create and select DB_NAME here rather than in
  // schema.sql. Keeping the name in exactly one place is what stops the tool from being
  // aimed at one database and writing to another.
  const admin = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  // The safety check throws on purpose. Without the finally the open socket would keep the
  // event loop alive and the command would hang instead of exiting with the explanation.
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await admin.query(`USE \`${env.db.database}\``);

    await assertSafeToWipe(admin);

    console.log(`Running schema.sql against '${env.db.database}' ...`);
    await admin.query(schemaSql);
  } finally {
    await admin.end();
  }

  const db = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
  });

  // The same cost the application uses. Seeding at a lower cost made the demo accounts
  // measurably weaker than every account created through the app.
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, env.bcryptRounds);

  console.log('Seeding demo accounts ...');
  const [adminUser] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    ['Admin User', 'admin@ssas.local', passwordHash, 'admin']
  );

  const [teacherUser] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    ['Hemanta Acharya', 'teacher@ssas.local', passwordHash, 'teacher']
  );
  await db.query('INSERT INTO teachers (user_id, department, designation) VALUES (?, ?, ?)', [
    teacherUser.insertId,
    'Computer Science',
    'Lecturer',
  ]);

  const [studentUser] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    ['Paras Thapa', 'student@ssas.local', passwordHash, 'student']
  );
  await db.query(
    'INSERT INTO students (user_id, student_number, program, semester, section) VALUES (?, ?, ?, ?, ?)',
    [studentUser.insertId, '23012003', 'BSc CSIT', '6', 'A']
  );

  const [course] = await db.query(
    'INSERT INTO courses (course_name, course_code, teacher_id, credit_hours) VALUES (?, ?, ?, ?)',
    ['Software Engineering', 'CSIT301', teacherUser.insertId, 3]
  );

  await db.query('INSERT INTO enrolments (student_id, course_id) VALUES (?, ?)', [
    studentUser.insertId,
    course.insertId,
  ]);

  // schema.sql is kept in step with the migrations, so a database built from it is already
  // at the latest version. Recording that stops db:migrate from trying to re-add columns
  // schema.sql has just created.
  await markAllApplied(db);

  console.log('\nDone. Seed accounts (all share one password):');
  console.log(`  Admin:   admin@ssas.local   / ${SEED_PASSWORD}`);
  console.log(`  Teacher: teacher@ssas.local / ${SEED_PASSWORD}`);
  console.log(`  Student: student@ssas.local / ${SEED_PASSWORD}`);
  console.log(`  Demo course: CSIT301 (id=${course.insertId}), student already enrolled.`);

  await db.end();
}

run().catch((err) => {
  console.error(err.expected ? `\n${err.message}\n` : `db:init failed: ${err.stack}`);
  process.exitCode = 1;
});
