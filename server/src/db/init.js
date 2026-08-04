/**
 * Creates the ssas database + schema, then seeds one account of each role plus
 * a demo course/enrolment so the API can be smoke-tested immediately.
 * Usage: npm run db:init   (from /server)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const env = require('../config/env');

const SEED_PASSWORD = 'Password123!';

async function run() {
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  const admin = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  console.log('Running schema.sql ...');
  await admin.query(schemaSql);
  await admin.end();

  const db = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
  });

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

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

  console.log('\nDone. Seed accounts (all share one password):');
  console.log(`  Admin:   admin@ssas.local   / ${SEED_PASSWORD}`);
  console.log(`  Teacher: teacher@ssas.local / ${SEED_PASSWORD}`);
  console.log(`  Student: student@ssas.local / ${SEED_PASSWORD}`);
  console.log(`  Demo course: CSIT301 (id=${course.insertId}), student already enrolled.`);

  await db.end();
}

run().catch((err) => {
  console.error('db:init failed:', err);
  process.exitCode = 1;
});
