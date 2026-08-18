const crypto = require('crypto');
const pool = require('../config/db');
const env = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const courseService = require('./course.service');

// The client sends ISO 8601 ("2026-08-18T14:51:12.373Z"). MariaDB parses that leniently, so it
// worked throughout development on XAMPP, but MySQL in strict mode rejects it outright:
// ER_TRUNCATED_WRONG_VALUE, "Incorrect datetime value ... for column 'start_time'". Handing
// mysql2 a Date instead lets it serialise the value itself, in UTC, per the pool's
// timezone: 'Z' - correct on both engines rather than only on the one used locally.
function toDateTime(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${field} is not a valid date`);
  }
  return date;
}

async function createSession({
  courseId,
  teacherId,
  room,
  geofenceLat,
  geofenceLng,
  geofenceRadiusM,
  qrValiditySeconds,
  authorisedSsid,
  authorisedSubnet,
  startTime,
  endTime,
}) {
  await courseService.assertTeacherOwnsCourse(courseId, teacherId);

  const qrSecret = crypto.randomBytes(32).toString('hex');

  const [result] = await pool.query(
    `INSERT INTO sessions
      (course_id, room, qr_secret, qr_validity_seconds, geofence_lat, geofence_lng,
       geofence_radius_m, authorised_ssid, authorised_subnet, start_time, end_time, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      courseId,
      room || null,
      qrSecret,
      qrValiditySeconds || env.qrValidityWindowSeconds,
      geofenceLat,
      geofenceLng,
      geofenceRadiusM || env.defaultGeofenceRadiusM,
      authorisedSsid || null,
      authorisedSubnet || 'any',
      toDateTime(startTime, 'startTime'),
      toDateTime(endTime, 'endTime'),
    ]
  );

  return getSessionById(result.insertId);
}

async function getSessionById(sessionId) {
  const [rows] = await pool.query(
    `SELECT s.*, c.course_name, c.course_code, c.teacher_id
     FROM sessions s JOIN courses c ON c.id = s.course_id
     WHERE s.id = ?`,
    [sessionId]
  );
  const session = rows[0];
  if (!session) throw new ApiError(404, 'Session not found');
  return session;
}

async function assertTeacherOwnsSession(sessionId, teacherId) {
  const session = await getSessionById(sessionId);
  if (session.teacher_id !== teacherId) {
    throw new ApiError(403, 'You do not own this session');
  }
  return session;
}

// Closing a session records WHEN it was closed; it does not rewrite when it was scheduled to
// finish. The previous `end_time = NOW()` destroyed that - a class cut 40 minutes short became
// indistinguishable from one that ran to plan, which is exactly the detail a student
// disputing an absence would need. is_active = 0 is what makes the session unscannable; the
// two together say "ended, and here is how early".
async function endSession(sessionId, teacherId) {
  await assertTeacherOwnsSession(sessionId, teacherId);
  await pool.query(
    'UPDATE sessions SET is_active = 0, ended_at = NOW() WHERE id = ? AND ended_at IS NULL',
    [sessionId]
  );
  return getSessionById(sessionId);
}

// Active sessions for courses the student is enrolled in, currently within their time window.
async function listActiveSessionsForStudent(studentId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.course_id, c.course_name, c.course_code, s.start_time, s.end_time,
            s.geofence_radius_m
     FROM sessions s
     JOIN courses c ON c.id = s.course_id
     JOIN enrolments e ON e.course_id = c.id AND e.student_id = ?
     WHERE s.is_active = 1 AND NOW() BETWEEN s.start_time AND s.end_time
     ORDER BY s.start_time DESC`,
    [studentId]
  );
  return rows;
}

async function listSessionsForCourse(courseId, teacherId, user) {
  if (user.role === 'teacher') {
    await courseService.assertTeacherOwnsCourse(courseId, teacherId);
  }
  const [rows] = await pool.query(
    `SELECT id, course_id, start_time, end_time, ended_at, is_active, geofence_radius_m
     FROM sessions WHERE course_id = ? ORDER BY start_time DESC`,
    [courseId]
  );
  return rows;
}

// Live roster: everyone enrolled in the course, joined against who has already checked in.
async function getLiveAttendance(sessionId, teacherId) {
  const session = await assertTeacherOwnsSession(sessionId, teacherId);

  const [rows] = await pool.query(
    `SELECT u.id AS student_id, u.name, s.student_number,
            ar.submitted_at, ar.distance_meters,
            ar.qr_check_passed, ar.geofence_check_passed, ar.network_check_passed,
            ar.marked_by, ar.mark_reason, m.name AS marked_by_name
     FROM enrolments e
     JOIN users u ON u.id = e.student_id
     JOIN students s ON s.user_id = u.id
     LEFT JOIN attendance_records ar ON ar.student_id = u.id AND ar.session_id = ?
     LEFT JOIN users m ON m.id = ar.marked_by
     WHERE e.course_id = ?
     ORDER BY (ar.submitted_at IS NULL), ar.submitted_at`,
    [sessionId, session.course_id]
  );

  const roster = rows.map((r) => ({
    ...r,
    method: r.submitted_at ? (r.marked_by ? 'manual' : 'verified') : null,
  }));

  // Failed attempts, grouped by reason. This is what turns an empty roster from a mystery
  // into a diagnosis: twelve NETWORK_UNAUTHORISED means the Wi-Fi is the problem, not the
  // students, and the teacher should be marking them manually rather than waiting.
  //
  // DUPLICATE_SUBMISSION is excluded - someone scanning twice is already marked present and
  // is not a failure the teacher needs to act on.
  const [failures] = await pool.query(
    `SELECT a.outcome, COUNT(*) AS attempts, COUNT(DISTINCT a.student_id) AS students,
            MAX(a.attempted_at) AS lastAt, MAX(a.distance_meters) AS worstDistance
     FROM attendance_attempts a
     WHERE a.session_id = ?
       AND a.outcome NOT IN ('SUCCESS', 'DUPLICATE_SUBMISSION')
     GROUP BY a.outcome
     ORDER BY students DESC`,
    [sessionId]
  );

  const present = roster.filter((r) => r.submitted_at).length;
  const manual = roster.filter((r) => r.method === 'manual').length;
  return {
    session,
    roster,
    presentCount: present,
    manualCount: manual,
    totalCount: roster.length,
    failures: failures.map((f) => ({
      outcome: f.outcome,
      attempts: Number(f.attempts),
      students: Number(f.students),
      lastAt: f.lastAt,
      worstDistance: f.worstDistance === null ? null : Number(f.worstDistance),
    })),
  };
}

// Teacher override for when the automated checks cannot run - Wi-Fi down, flat battery, a
// camera that will not focus. The student was in the room; the system could not prove it.
//
// The three check flags are written as 0, not 1. Recording a manual mark as though all three
// factors had passed would put a claim in the database that nobody ever verified, and the
// whole value of this system is that its records mean something specific.
async function markAttendanceManually({ sessionId, studentId, teacherId, reason }) {
  const session = await assertTeacherOwnsSession(sessionId, teacherId);

  const [[enrolled]] = await pool.query(
    'SELECT COUNT(*) AS n FROM enrolments WHERE course_id = ? AND student_id = ?',
    [session.course_id, studentId]
  );
  if (enrolled.n === 0) {
    throw new ApiError(400, 'That student is not enrolled in this course');
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO attendance_records
        (session_id, student_id, qr_check_passed, geofence_check_passed, network_check_passed,
         distance_meters, device_fingerprint, marked_by, mark_reason)
       VALUES (?, ?, 0, 0, 0, NULL, NULL, ?, ?)`,
      [sessionId, studentId, teacherId, reason || null]
    );
    return { recordId: result.insertId, sessionId, studentId, method: 'manual' };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new ApiError(409, 'That student already has attendance for this session');
    }
    throw err;
  }
}

// Undo applies to manual marks only. A record produced by a real scan is evidence the student
// was present, and a teacher being able to delete it would make attendance a matter of
// opinion. Removing one of those is a data-correction job, not a routine action.
async function removeManualMark({ sessionId, studentId, teacherId }) {
  await assertTeacherOwnsSession(sessionId, teacherId);

  const [rows] = await pool.query(
    'SELECT id, marked_by FROM attendance_records WHERE session_id = ? AND student_id = ?',
    [sessionId, studentId]
  );
  const record = rows[0];
  if (!record) throw new ApiError(404, 'That student has no attendance for this session');
  if (record.marked_by === null) {
    throw new ApiError(
      409,
      'That attendance was recorded by a verified scan and cannot be removed here'
    );
  }

  await pool.query('DELETE FROM attendance_records WHERE id = ?', [record.id]);
}

// Every session this teacher has ever run, newest first. The dashboard only shows today;
// this is where you go to find the class from three weeks ago whose register is disputed.
async function listSessionsForTeacher(teacherId, { query, status } = {}) {
  const params = [teacherId];
  let where = 'WHERE c.teacher_id = ?';

  if (query) {
    // Course name, code and room are the three things a teacher would actually type.
    where += ' AND (c.course_name LIKE ? OR c.course_code LIKE ? OR s.room LIKE ?)';
    const like = `%${query}%`;
    params.push(like, like, like);
  }

  if (status === 'live') {
    where += ' AND s.is_active = 1 AND NOW() BETWEEN s.start_time AND s.end_time';
  } else if (status === 'scheduled') {
    where += ' AND s.is_active = 1 AND s.start_time > NOW()';
  } else if (status === 'completed') {
    where += ' AND (s.is_active = 0 OR s.end_time < NOW())';
  }

  const [rows] = await pool.query(
    `SELECT s.id, s.room, s.start_time, s.end_time, s.ended_at, s.is_active,
            s.geofence_radius_m, s.authorised_subnet,
            c.id AS course_id, c.course_name, c.course_code,
            (SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id)          AS enrolled,
            (SELECT COUNT(*) FROM attendance_records a WHERE a.session_id = s.id) AS present,
            (SELECT COUNT(*) FROM attendance_records a
              WHERE a.session_id = s.id AND a.marked_by IS NOT NULL)              AS manual
     FROM sessions s
     JOIN courses c ON c.id = s.course_id
     ${where}
     ORDER BY s.start_time DESC
     LIMIT 200`,
    params
  );

  return rows.map(shapeSession);
}

// A teacher's courses with the numbers that make the list worth reading: how many are
// enrolled, how many sessions have run, and the attendance rate across them.
async function listCourseStatsForTeacher(teacherId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.course_name, c.course_code, c.credit_hours,
            (SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id) AS enrolled,
            (SELECT COUNT(*) FROM sessions s
              WHERE s.course_id = c.id AND s.start_time <= NOW())        AS sessionsHeld,
            (SELECT COUNT(*) FROM attendance_records a
               JOIN sessions s2 ON s2.id = a.session_id
              WHERE s2.course_id = c.id AND s2.start_time <= NOW())      AS totalPresent
     FROM courses c
     WHERE c.teacher_id = ?
     ORDER BY c.course_name`,
    [teacherId]
  );

  return rows.map((r) => {
    const possible = Number(r.enrolled) * Number(r.sessionsHeld);
    return {
      id: r.id,
      courseName: r.course_name,
      courseCode: r.course_code,
      creditHours: r.credit_hours,
      enrolled: Number(r.enrolled),
      sessionsHeld: Number(r.sessionsHeld),
      // null rather than 0 when nothing has run yet - an untaught course has no rate, and
      // showing 0% would read as "nobody turns up".
      attendanceRate: possible > 0 ? round1((Number(r.totalPresent) / possible) * 100) : null,
    };
  });
}

// Everything the teacher dashboard shows, in one round trip. Deliberately computed rather
// than stored: none of these are facts anyone enters, so a cached copy could only ever be
// wrong.
async function getTeacherOverview(teacherId) {
  const [[teacher]] = await pool.query(
    `SELECT u.name, t.department, t.designation
     FROM users u LEFT JOIN teachers t ON t.user_id = u.id WHERE u.id = ?`,
    [teacherId]
  );

  // Today's sessions, with the enrolled headcount and how many have checked in so far.
  const [today] = await pool.query(
    `SELECT s.id, s.room, s.start_time, s.end_time, s.ended_at, s.is_active,
            s.geofence_radius_m,
            c.id AS course_id, c.course_name, c.course_code,
            (SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id)              AS enrolled,
            (SELECT COUNT(*) FROM attendance_records a WHERE a.session_id = s.id)     AS present
     FROM sessions s
     JOIN courses c ON c.id = s.course_id
     WHERE c.teacher_id = ?
       AND s.start_time >= CURDATE()
       AND s.start_time <  CURDATE() + INTERVAL 1 DAY
     ORDER BY s.start_time`,
    [teacherId]
  );

  // Anything still scannable right now, across all of this teacher's courses.
  const [live] = await pool.query(
    `SELECT s.id, s.room, s.start_time, s.end_time, s.geofence_radius_m,
            c.course_name, c.course_code,
            (SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id)          AS enrolled,
            (SELECT COUNT(*) FROM attendance_records a WHERE a.session_id = s.id) AS present
     FROM sessions s
     JOIN courses c ON c.id = s.course_id
     WHERE c.teacher_id = ?
       AND s.is_active = 1
       AND NOW() BETWEEN s.start_time AND s.end_time
     ORDER BY s.start_time`,
    [teacherId]
  );

  const [[totals]] = await pool.query(
    // DISTINCT because a student enrolled in two of this teacher's courses is still one
    // student - counting enrolments here would quietly inflate the roll.
    `SELECT COUNT(DISTINCT e.student_id) AS totalStudents,
            COUNT(DISTINCT c.id)         AS totalCourses
     FROM courses c
     LEFT JOIN enrolments e ON e.course_id = c.id
     WHERE c.teacher_id = ?`,
    [teacherId]
  );

  // Attendance rate over the last 7 days and the 7 before it, so the headline number can be
  // reported as a movement rather than a bare percentage.
  const [[thisWeek]] = await pool.query(weekRateSql(6, -1), [teacherId]);
  const [[lastWeek]] = await pool.query(weekRateSql(13, 6), [teacherId]);

  // Students at risk in this teacher's courses. This is the actionable half of the
  // dashboard: a percentage tells you something is wrong, a list tells you who to talk to.
  const min = env.minimumAttendancePercent;
  const [atRisk] = await pool.query(
    `SELECT u.id AS student_id, u.name, st.student_number,
            c.id AS course_id, c.course_code, c.course_name,
            COUNT(s.id)            AS totalSessions,
            SUM(a.id IS NOT NULL)  AS attended
     FROM courses c
     JOIN enrolments e  ON e.course_id = c.id
     JOIN users u       ON u.id = e.student_id
     JOIN students st   ON st.user_id = u.id
     LEFT JOIN sessions s ON s.course_id = c.id
                         AND s.start_time <= NOW()
                         AND s.start_time >= e.enrolment_date
     LEFT JOIN attendance_records a ON a.session_id = s.id AND a.student_id = u.id
     WHERE c.teacher_id = ?
     GROUP BY u.id, u.name, st.student_number, c.id, c.course_code, c.course_name
     HAVING totalSessions > 0 AND (SUM(a.id IS NOT NULL) / COUNT(s.id)) * 100 < ?
     ORDER BY (SUM(a.id IS NOT NULL) / COUNT(s.id)) ASC, u.name`,
    [teacherId, min]
  );

  const [upcoming] = await pool.query(
    `SELECT s.id, s.room, s.start_time, s.end_time, c.course_name, c.course_code,
            (SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id) AS enrolled
     FROM sessions s
     JOIN courses c ON c.id = s.course_id
     WHERE c.teacher_id = ?
       AND s.start_time >= CURDATE() + INTERVAL 1 DAY
       AND s.is_active = 1
     ORDER BY s.start_time
     LIMIT 5`,
    [teacherId]
  );

  const completed = today.filter((s) => !s.is_active || new Date(s.end_time) < new Date()).length;

  return {
    teacher: { name: teacher?.name, department: teacher?.department, designation: teacher?.designation },
    minimumAttendancePercent: min,
    today: today.map(shapeSession),
    todayCompleted: completed,
    todayRemaining: today.length - completed,
    live: live.map(shapeSession),
    totals: {
      totalStudents: Number(totals.totalStudents || 0),
      totalCourses: Number(totals.totalCourses || 0),
    },
    weeklyAttendance: {
      // null (not 0) when no sessions were held - "no classes this week" and "nobody came"
      // are different facts and must not render as the same number.
      current: thisWeek.total > 0 ? round1((thisWeek.present / thisWeek.total) * 100) : null,
      previous: lastWeek.total > 0 ? round1((lastWeek.present / lastWeek.total) * 100) : null,
      sessionsHeld: Number(thisWeek.sessions || 0),
    },
    atRisk: atRisk.map((r) => ({
      studentId: r.student_id,
      name: r.name,
      studentNumber: r.student_number,
      courseId: r.course_id,
      courseCode: r.course_code,
      courseName: r.course_name,
      totalSessions: Number(r.totalSessions),
      attended: Number(r.attended),
      missed: Number(r.totalSessions) - Number(r.attended),
      attendancePercentage: round1((Number(r.attended) / Number(r.totalSessions)) * 100),
    })),
    upcoming,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function shapeSession(s) {
  const now = new Date();
  const started = new Date(s.start_time) <= now;
  const finished = !s.is_active || new Date(s.end_time) < now;
  return {
    ...s,
    enrolled: Number(s.enrolled || 0),
    present: Number(s.present || 0),
    status: finished ? 'completed' : started ? 'live' : 'scheduled',
  };
}

// Attendance rate across every session this teacher held in a window running from
// `fromDaysAgo` days back up to (but not including) `toDaysAgo` days back.
//
// The bounds are half-open on whole days and BOTH ends are exclusive-of-the-next-day, which
// is the part that is easy to get wrong: an upper bound of `CURDATE() - INTERVAL 0 DAY` is
// midnight this morning, so it silently excludes every class held today - exactly the ones a
// teacher checking their dashboard mid-afternoon cares about. Passing -1 makes the upper
// bound tomorrow-midnight, so "this week" genuinely includes today.
//
// Denominator is enrolments-per-session, not sessions, so a 40-student class weighs more
// than a 5-student one - which is what "average attendance" has to mean.
function weekRateSql(fromDaysAgo, toDaysAgo) {
  return `
    SELECT COUNT(DISTINCT s.id) AS sessions,
           COALESCE(SUM((SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id)), 0) AS total,
           COALESCE(SUM((SELECT COUNT(*) FROM attendance_records a WHERE a.session_id = s.id)), 0) AS present
    FROM sessions s
    JOIN courses c ON c.id = s.course_id
    WHERE c.teacher_id = ?
      AND s.start_time >= CURDATE() - INTERVAL ${fromDaysAgo} DAY
      AND s.start_time <  CURDATE() - INTERVAL ${toDaysAgo} DAY
      -- A class that has not started yet cannot have been attended; counting it would drag
      -- the week's rate down every morning and recover it by evening.
      AND s.start_time <= NOW()
  `;
}

module.exports = {
  createSession,
  getTeacherOverview,
  listSessionsForTeacher,
  listCourseStatsForTeacher,
  getSessionById,
  assertTeacherOwnsSession,
  endSession,
  listActiveSessionsForStudent,
  listSessionsForCourse,
  getLiveAttendance,
  markAttendanceManually,
  removeManualMark,
};
