const bcrypt = require('bcrypt');
const pool = require('../config/db');
const env = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const authService = require('./auth.service');

const BCRYPT_ROUNDS = env.bcryptRounds;

// Provisioning path for staff accounts. Public /auth/register is pinned to 'student', so
// this admin-guarded route is the only way a teacher or admin account can come into being.
async function createUser({ name, email, password, role, profile }) {
  return authService.register({ name, email, password, role, profile });
}

// Bulk provisioning: a college enrols students by the hundred, and creating them one form at
// a time is how the "just let them sign up themselves" shortcut gets taken.
//
// Each row is committed independently rather than in one transaction. A single duplicate
// student number in a 300-row paste should not throw away the other 299 - the caller gets a
// per-row report and can fix and re-run, and re-running is safe because duplicates are
// reported rather than re-created.
async function importStudents(rows) {
  const created = [];
  const skipped = [];

  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    const name = String(row.name || '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    const studentNumber = String(row.studentNumber || '').trim();
    const password = String(row.password || '').trim();

    if (!name || !email || !studentNumber) {
      skipped.push({ line, studentNumber, email, reason: 'name, email and studentNumber are all required' });
      continue;
    }
    if (password && password.length < 8) {
      skipped.push({ line, studentNumber, email, reason: 'password must be at least 8 characters' });
      continue;
    }

    try {
      const user = await authService.register({
        name,
        email,
        // With no password column in the sheet the student number doubles as the initial
        // password - the college hands out both together, and the student is expected to
        // change it. It is never left as the only credential: changePassword revokes every
        // session, so the first change is a clean break.
        password: password || studentNumber,
        role: 'student',
        profile: {
          studentNumber,
          program: row.program || null,
          semester: row.semester || null,
          section: row.section || null,
        },
      });
      created.push({ line, id: user.id, name, email, studentNumber });
    } catch (err) {
      const reason =
        err.code === 'ER_DUP_ENTRY'
          ? 'that student number is already in use'
          : err.message || 'could not be created';
      skipped.push({ line, studentNumber, email, reason });
    }
  }

  return { createdCount: created.length, skippedCount: skipped.length, created, skipped };
}

// Password recovery without an email server: an admin sets a temporary password and hands
// it to the user out-of-band. Every existing session for that account is dropped, so if the
// reset was prompted by a suspected compromise the attacker is logged out too.
async function resetUserPassword(userId, newPassword) {
  const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [userId]);
  if (rows.length === 0) throw new ApiError(404, 'User not found');

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
}

// Lets an admin correct an account that holds the wrong role - notably a student who
// signed up as a teacher back when the public form still allowed it.
async function changeUserRole(userId, newRole, actingAdminId) {
  if (userId === actingAdminId) {
    throw new ApiError(400, 'You cannot change your own role');
  }

  const [rows] = await pool.query('SELECT id, role FROM users WHERE id = ?', [userId]);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === newRole) return;

  // Demoting the last admin locks the institution out of user management just as thoroughly
  // as deleting them.
  if (user.role === 'admin') {
    const [[{ admins }]] = await pool.query(
      "SELECT COUNT(*) AS admins FROM users WHERE role = 'admin'"
    );
    if (admins <= 1) {
      throw new ApiError(409, 'This is the only admin account; promote another user first');
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query('UPDATE users SET role = ? WHERE id = ?', [newRole, userId]);

    // The role-specific detail rows must follow the role, or the account ends up as a
    // teacher with no teachers row (breaking course ownership joins) or a student with no
    // student_number (breaking every attendance report they should appear in).
    if (newRole === 'student') {
      await connection.query('DELETE FROM teachers WHERE user_id = ?', [userId]);
      await connection.query(
        `INSERT INTO students (user_id, student_number, program, semester, section)
         VALUES (?, ?, NULL, NULL, NULL)
         ON DUPLICATE KEY UPDATE user_id = user_id`,
        [userId, `S${userId}`]
      );
    } else if (newRole === 'teacher') {
      await connection.query('DELETE FROM students WHERE user_id = ?', [userId]);
      await connection.query(
        `INSERT INTO teachers (user_id, department, designation)
         VALUES (?, NULL, NULL)
         ON DUPLICATE KEY UPDATE user_id = user_id`,
        [userId]
      );
    } else {
      await connection.query('DELETE FROM students WHERE user_id = ?', [userId]);
      await connection.query('DELETE FROM teachers WHERE user_id = ?', [userId]);
    }

    // Their existing sessions were issued against the old privilege level.
    await connection.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
      [userId]
    );

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// student_number comes back with the list because it is what a student actually signs in
// with. An admin looking at this screen to help someone who cannot log in needs to see the
// ID on their card, not just their email.
async function listUsers({ role } = {}) {
  const params = [];
  let where = '';
  if (role) {
    where = 'WHERE u.role = ?';
    params.push(role);
  }
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.created_at, s.student_number
     FROM users u
     LEFT JOIN students s ON s.user_id = u.id
     ${where}
     ORDER BY u.created_at DESC`,
    params
  );
  return rows;
}

// The college ID is deliberately not editable by the student who owns it - attendance
// records and reports are keyed against it, so self-service edits would let someone rewrite
// their own audit trail. But it still has to be correctable: a typo at import time, or an
// account created before provisioning existed, leaves a student holding an ID that matches
// no card and therefore cannot be used to sign in. That correction belongs to an admin.
// Full record for one user, including the role-specific detail row.
async function getUser(userId) {
  return authService.getProfile(userId);
}

// Admin-side correction of a user's record. Delegates to the auth service so account
// updates keep happening in exactly one place.
async function updateUserProfile(userId, { name, email, profile }) {
  return authService.updateUserRecord(userId, { name, email, profile });
}

async function setStudentNumber(userId, studentNumber) {
  const [rows] = await pool.query('SELECT id, role FROM users WHERE id = ?', [userId]);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role !== 'student') {
    throw new ApiError(400, 'Only student accounts have a college ID');
  }

  const value = String(studentNumber).trim();

  try {
    const [result] = await pool.query(
      'UPDATE students SET student_number = ? WHERE user_id = ?',
      [value, userId]
    );
    if (result.affectedRows === 0) {
      throw new ApiError(404, 'That student has no student record to update');
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new ApiError(409, 'Another student already has that college ID');
    }
    throw err;
  }

  // Not revoking their sessions on purpose: the account is the same account, and signing
  // someone out mid-class over an administrative correction would cost them a check-in.
  return { userId, studentNumber: value };
}

async function deleteUser(userId) {
  const [rows] = await pool.query('SELECT id, role FROM users WHERE id = ?', [userId]);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found');

  // The admin UI hides the delete button on your own row, but the API is reachable directly
  // and removing the last admin locks everyone out of user management permanently - there is
  // no route that can mint a replacement without an admin already signed in.
  if (user.role === 'admin') {
    const [[{ admins }]] = await pool.query(
      "SELECT COUNT(*) AS admins FROM users WHERE role = 'admin'"
    );
    if (admins <= 1) {
      throw new ApiError(409, 'This is the only admin account; promote another user first');
    }
  }

  await pool.query('DELETE FROM users WHERE id = ?', [userId]);
}

const round1 = (n) => Math.round(n * 10) / 10;

// Attendance rate over a whole-day window, weighted by enrolment so a 200-seat lecture
// counts for more than a 6-person tutorial - which is what an institution-wide rate has to
// mean. Upper bound is exclusive-of-the-next-day so "this week" includes today.
function institutionRateSql(fromDaysAgo, toDaysAgo) {
  return `
    SELECT COUNT(DISTINCT s.id) AS sessions,
           COALESCE(SUM((SELECT COUNT(*) FROM enrolments e WHERE e.course_id = s.course_id)), 0) AS possible,
           COALESCE(SUM((SELECT COUNT(*) FROM attendance_records a WHERE a.session_id = s.id)), 0) AS present
    FROM sessions s
    WHERE s.start_time >= CURDATE() - INTERVAL ${fromDaysAgo} DAY
      AND s.start_time <  CURDATE() - INTERVAL ${toDaysAgo} DAY
      AND s.start_time <= NOW()
  `;
}

async function getAnalytics() {
  const min = env.minimumAttendancePercent;

  const [[userCounts]] = await pool.query(
    `SELECT
       SUM(role = 'student') AS students,
       SUM(role = 'teacher') AS teachers,
       SUM(role = 'admin')   AS admins
     FROM users`
  );

  const [[courseCounts]] = await pool.query('SELECT COUNT(*) AS totalCourses FROM courses');
  const [[sessionCounts]] = await pool.query(
    `SELECT COUNT(*) AS totalSessions,
            SUM(is_active = 1 AND NOW() BETWEEN start_time AND end_time) AS activeSessions,
            SUM(start_time >= CURDATE() - INTERVAL 6 DAY AND start_time <= NOW()) AS sessionsThisWeek
     FROM sessions`
  );

  // Manual marks are a trust signal, not a usage one: they are attendance a teacher asserted
  // rather than the three factors verified. An admin is the only person positioned to notice
  // if that share starts climbing.
  const [[attendanceCounts]] = await pool.query(
    `SELECT COUNT(*) AS totalAttendanceRecords,
            SUM(marked_by IS NOT NULL) AS manualRecords
     FROM attendance_records`
  );

  const [[thisWeek]] = await pool.query(institutionRateSql(6, -1));
  const [[lastWeek]] = await pool.query(institutionRateSql(13, 6));

  // Ranked by attendance RATE, not by how many records exist. The old query ordered by raw
  // COUNT(attendance_records), which just found the biggest courses: 200 students x 2
  // sessions outranks 10 students x 30 sessions while saying nothing about either.
  const [courses] = await pool.query(
    `SELECT c.id, c.course_name, c.course_code, u.name AS teacher_name,
            (SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id) AS enrolled,
            (SELECT COUNT(*) FROM sessions s
              WHERE s.course_id = c.id AND s.start_time <= NOW())        AS sessionsHeld,
            (SELECT COUNT(*) FROM attendance_records a
               JOIN sessions s2 ON s2.id = a.session_id
              WHERE s2.course_id = c.id AND s2.start_time <= NOW())      AS present
     FROM courses c
     LEFT JOIN users u ON u.id = c.teacher_id
     ORDER BY c.course_name`
  );

  const courseHealth = courses.map((c) => {
    const possible = Number(c.enrolled) * Number(c.sessionsHeld);
    const rate = possible > 0 ? round1((Number(c.present) / possible) * 100) : null;
    return {
      id: c.id,
      courseName: c.course_name,
      courseCode: c.course_code,
      teacherName: c.teacher_name,
      enrolled: Number(c.enrolled),
      sessionsHeld: Number(c.sessionsHeld),
      attendanceRate: rate,
      // A course with no sessions is not failing - it has not started. Excluded from the
      // at-risk count rather than counted as 0%.
      atRisk: rate !== null && rate < min,
    };
  });

  const [[studentsAtRisk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM (
       SELECT e.student_id
       FROM enrolments e
       JOIN sessions s ON s.course_id = e.course_id
                      AND s.start_time <= NOW()
                      AND s.start_time >= e.enrolment_date
       LEFT JOIN attendance_records a ON a.session_id = s.id AND a.student_id = e.student_id
       GROUP BY e.student_id, e.course_id
       HAVING COUNT(s.id) > 0 AND (SUM(a.id IS NOT NULL) / COUNT(s.id)) * 100 < ?
     ) AS at_risk`,
    [min]
  );

  // Why check-ins are failing, institution-wide. A spike in NETWORK_UNAUTHORISED is an
  // infrastructure problem for the admin to fix, not a discipline problem for teachers.
  const [failureReasons] = await pool.query(
    `SELECT outcome, COUNT(*) AS attempts, COUNT(DISTINCT student_id) AS students
     FROM attendance_attempts
     WHERE outcome NOT IN ('SUCCESS', 'DUPLICATE_SUBMISSION')
       AND attempted_at >= NOW() - INTERVAL 7 DAY
     GROUP BY outcome
     ORDER BY attempts DESC`
  );

  // Configuration gaps that quietly make the system wrong rather than broken: nobody is
  // told, and the data just comes out short.
  const [[gaps]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM courses WHERE teacher_id IS NULL) AS coursesWithoutTeacher,
       (SELECT COUNT(*) FROM courses c
         WHERE NOT EXISTS (SELECT 1 FROM enrolments e WHERE e.course_id = c.id)) AS coursesWithoutStudents,
       (SELECT COUNT(*) FROM users u
         WHERE u.role = 'student'
           AND NOT EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = u.id)) AS studentsWithoutCourses,
       (SELECT COUNT(*) FROM users u
         WHERE u.role = 'teacher'
           AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.teacher_id = u.id)) AS teachersWithoutCourses`
  );

  const totalRecords = Number(attendanceCounts.totalAttendanceRecords || 0);
  const manualRecords = Number(attendanceCounts.manualRecords || 0);

  return {
    minimumAttendancePercent: min,
    users: {
      students: Number(userCounts.students || 0),
      teachers: Number(userCounts.teachers || 0),
      admins: Number(userCounts.admins || 0),
    },
    totalCourses: courseCounts.totalCourses,
    totalSessions: sessionCounts.totalSessions,
    sessionsThisWeek: Number(sessionCounts.sessionsThisWeek || 0),
    activeSessions: Number(sessionCounts.activeSessions || 0),
    totalAttendanceRecords: totalRecords,
    manualRecords,
    manualSharePercent: totalRecords > 0 ? round1((manualRecords / totalRecords) * 100) : null,
    attendance: {
      // null, not 0: "no classes were held" and "nobody attended" are different facts and
      // must not render as the same number.
      current: thisWeek.possible > 0 ? round1((thisWeek.present / thisWeek.possible) * 100) : null,
      previous: lastWeek.possible > 0 ? round1((lastWeek.present / lastWeek.possible) * 100) : null,
      sessionsThisWeek: Number(thisWeek.sessions || 0),
    },
    courses: courseHealth,
    coursesAtRisk: courseHealth.filter((c) => c.atRisk).length,
    studentsAtRisk: Number(studentsAtRisk.n || 0),
    failureReasons: failureReasons.map((f) => ({
      outcome: f.outcome,
      attempts: Number(f.attempts),
      students: Number(f.students),
    })),
    gaps: {
      coursesWithoutTeacher: Number(gaps.coursesWithoutTeacher || 0),
      coursesWithoutStudents: Number(gaps.coursesWithoutStudents || 0),
      studentsWithoutCourses: Number(gaps.studentsWithoutCourses || 0),
      teachersWithoutCourses: Number(gaps.teachersWithoutCourses || 0),
    },
  };
}

module.exports = {
  listUsers,
  deleteUser,
  getAnalytics,
  createUser,
  changeUserRole,
  resetUserPassword,
  importStudents,
  setStudentNumber,
  getUser,
  updateUserProfile,
};
