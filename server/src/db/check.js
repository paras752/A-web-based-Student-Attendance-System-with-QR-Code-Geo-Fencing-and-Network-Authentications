/**
 * Read-only integrity report: `npm run db:check`.
 *
 * Some invariants this system depends on cannot be expressed as constraints - "a student can
 * only have attendance for a course they are enrolled in" spans three tables, and the
 * role/detail-row pairing is enforced by application code that an admin action could get
 * wrong. This script asks the database directly, so drift is something you find on purpose
 * rather than when a report comes out wrong.
 *
 * Exits non-zero if any check fails, so it can be wired into CI or a pre-demo checklist.
 */
const pool = require('./../config/db');
const env = require('../config/env');
const { RETENTION_DAYS, ATTEMPT_RETENTION_DAYS } = require('../services/maintenance.service');

const CHECKS = [
  {
    label: 'students detail rows all belong to role=student',
    sql: `SELECT COUNT(*) n FROM students s JOIN users u ON u.id = s.user_id WHERE u.role <> 'student'`,
  },
  {
    label: 'teachers detail rows all belong to role=teacher',
    sql: `SELECT COUNT(*) n FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.role <> 'teacher'`,
  },
  {
    label: 'every role=student user has a students row',
    sql: `SELECT COUNT(*) n FROM users u LEFT JOIN students s ON s.user_id = u.id
          WHERE u.role = 'student' AND s.user_id IS NULL`,
  },
  {
    label: 'every role=teacher user has a teachers row',
    sql: `SELECT COUNT(*) n FROM users u LEFT JOIN teachers t ON t.user_id = u.id
          WHERE u.role = 'teacher' AND t.user_id IS NULL`,
  },
  {
    label: 'courses are owned by teachers',
    sql: `SELECT COUNT(*) n FROM courses c JOIN users u ON u.id = c.teacher_id WHERE u.role <> 'teacher'`,
  },
  {
    label: 'enrolments belong to students',
    sql: `SELECT COUNT(*) n FROM enrolments e JOIN users u ON u.id = e.student_id WHERE u.role <> 'student'`,
  },
  {
    label: 'attendance records belong to students',
    sql: `SELECT COUNT(*) n FROM attendance_records a JOIN users u ON u.id = a.student_id WHERE u.role <> 'student'`,
  },
  {
    // The most consequential one: an attendance record for a course the student is not
    // enrolled in is invisible to every report (reports iterate the enrolment roster), so it
    // would silently never appear as either present or absent.
    label: 'no attendance for a course the student is not enrolled in',
    sql: `SELECT COUNT(*) n FROM attendance_records a
          JOIN sessions s ON s.id = a.session_id
          LEFT JOIN enrolments e ON e.course_id = s.course_id AND e.student_id = a.student_id
          WHERE e.id IS NULL`,
  },
  {
    label: 'sessions end after they start',
    sql: `SELECT COUNT(*) n FROM sessions WHERE end_time <= start_time`,
  },
  {
    label: 'no session still flagged active past its end time',
    sql: `SELECT COUNT(*) n FROM sessions WHERE is_active = 1 AND end_time < NOW()`,
  },
  {
    label: 'geofence radius is positive',
    sql: `SELECT COUNT(*) n FROM sessions WHERE geofence_radius_m <= 0`,
  },
  {
    // Not "any expired token" - those are harmless and kept deliberately for a grace period.
    // A row past the retention window means the background purge is not running.
    label: 'no refresh tokens past the retention window',
    sql: `SELECT COUNT(*) n FROM refresh_tokens
          WHERE (expires_at < NOW() - INTERVAL ${RETENTION_DAYS} DAY)
             OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL ${RETENTION_DAYS} DAY)`,
  },
  {
    // The seed script once hardcoded cost 10 while the app used 12, so the demo accounts a
    // reviewer logs in with were weaker than the report claimed. Asserted here so the two
    // cannot drift apart again unnoticed.
    label: `every password hashed at bcrypt cost ${env.bcryptRounds}`,
    sql: `SELECT COUNT(*) n FROM users
          WHERE password_hash NOT LIKE '$2%$${String(env.bcryptRounds).padStart(2, '0')}$%'`,
  },
  {
    // A successful attempt must have a matching attendance record. If one exists without
    // the other, the audit log and the register disagree about what happened.
    label: 'every SUCCESS attempt has a matching attendance record',
    sql: `SELECT COUNT(*) n FROM attendance_attempts a
          LEFT JOIN attendance_records r
                 ON r.session_id = a.session_id AND r.student_id = a.student_id
          WHERE a.outcome = 'SUCCESS' AND r.id IS NULL`,
  },
  {
    label: 'no attendance attempts past the retention window',
    sql: `SELECT COUNT(*) n FROM attendance_attempts
          WHERE attempted_at < NOW() - INTERVAL ${ATTEMPT_RETENTION_DAYS} DAY`,
  },
];

// Not a SQL check: bcrypt hashes are salted, so the only way to know an account still uses
// the seed password is to compare against it. Worth the ~100 ms per account, because a
// deployment left on the password printed in the README is the single most likely way this
// system gets taken over - and nothing else in the codebase would ever notice.
async function checkSeedPasswords() {
  const bcrypt = require('bcrypt');
  const [users] = await pool.query('SELECT email, role, password_hash FROM users');
  const offenders = [];
  for (const u of users) {
    if (await bcrypt.compare('Password123!', u.password_hash)) {
      offenders.push(`${u.email} (${u.role})`);
    }
  }
  return offenders;
}

async function run() {
  const [[version]] = await pool.query('SELECT DATABASE() AS db, VERSION() AS server');
  console.log(`\n${version.db} on ${version.server}\n`);

  const [applied] = await pool.query(
    `SELECT version FROM schema_migrations ORDER BY version`
  ).catch(() => [[]]);
  console.log(`Schema version: ${applied.length ? applied[applied.length - 1].version : 'none recorded'}\n`);

  let failures = 0;
  for (const check of CHECKS) {
    const [[row]] = await pool.query(check.sql);
    const failed = Number(row.n) > 0;
    if (failed) failures += 1;
    console.log(`  ${failed ? 'FAIL' : ' ok '}  ${failed ? String(row.n).padStart(4) + '  ' : '      '}${check.label}`);
  }

  const [counts] = await pool.query(
    `SELECT 'users' t, COUNT(*) n FROM users
     UNION ALL SELECT 'courses', COUNT(*) FROM courses
     UNION ALL SELECT 'enrolments', COUNT(*) FROM enrolments
     UNION ALL SELECT 'sessions', COUNT(*) FROM sessions
     UNION ALL SELECT 'attendance_records', COUNT(*) FROM attendance_records
     UNION ALL SELECT 'attendance_attempts', COUNT(*) FROM attendance_attempts
     UNION ALL SELECT 'attempts (failed)', COUNT(*) FROM attendance_attempts WHERE outcome <> 'SUCCESS'
     UNION ALL SELECT 'refresh_tokens (live)', COUNT(*) FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at >= NOW()
     UNION ALL SELECT 'refresh_tokens (total)', COUNT(*) FROM refresh_tokens`
  );
  console.log('');
  for (const row of counts) console.log(`  ${String(row.n).padStart(6)}  ${row.t}`);

  // Reported as a warning rather than a failure: the demo accounts are supposed to use the
  // seed password during development, so failing here would make the check useless locally.
  // It has to be impossible to MISS before a real deployment, not impossible to have.
  const seedAccounts = await checkSeedPasswords();
  if (seedAccounts.length > 0) {
    console.log('\n  WARNING  these accounts still use the seed password from the README:');
    seedAccounts.forEach((a) => console.log(`           - ${a}`));
    console.log('           Fine for local development. Before deploying anywhere real:');
    console.log('             npm run admin:create -- --email you@college.edu --name "Your Name"');
    console.log('           then reset or remove these from Admin -> Users.');
  }

  console.log(failures === 0 ? '\nAll integrity checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exitCode = 1;
  });
