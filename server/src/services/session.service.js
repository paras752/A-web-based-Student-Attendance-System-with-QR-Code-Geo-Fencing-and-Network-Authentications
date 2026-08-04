const crypto = require('crypto');
const pool = require('../config/db');
const env = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const courseService = require('./course.service');

async function createSession({
  courseId,
  teacherId,
  geofenceLat,
  geofenceLng,
  geofenceRadiusM,
  authorisedSsid,
  authorisedSubnet,
  startTime,
  endTime,
}) {
  await courseService.assertTeacherOwnsCourse(courseId, teacherId);

  const qrSecret = crypto.randomBytes(32).toString('hex');

  const [result] = await pool.query(
    `INSERT INTO sessions
      (course_id, qr_secret, geofence_lat, geofence_lng, geofence_radius_m,
       authorised_ssid, authorised_subnet, start_time, end_time, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      courseId,
      qrSecret,
      geofenceLat,
      geofenceLng,
      geofenceRadiusM || env.defaultGeofenceRadiusM,
      authorisedSsid || null,
      authorisedSubnet || 'any',
      startTime,
      endTime,
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

async function endSession(sessionId, teacherId) {
  await assertTeacherOwnsSession(sessionId, teacherId);
  await pool.query('UPDATE sessions SET is_active = 0, end_time = NOW() WHERE id = ?', [
    sessionId,
  ]);
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
    `SELECT id, course_id, start_time, end_time, is_active, geofence_radius_m
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
            ar.qr_check_passed, ar.geofence_check_passed, ar.network_check_passed
     FROM enrolments e
     JOIN users u ON u.id = e.student_id
     JOIN students s ON s.user_id = u.id
     LEFT JOIN attendance_records ar ON ar.student_id = u.id AND ar.session_id = ?
     WHERE e.course_id = ?
     ORDER BY (ar.submitted_at IS NULL), ar.submitted_at`,
    [sessionId, session.course_id]
  );

  const present = rows.filter((r) => r.submitted_at).length;
  return { session, roster: rows, presentCount: present, totalCount: rows.length };
}

module.exports = {
  createSession,
  getSessionById,
  assertTeacherOwnsSession,
  endSession,
  listActiveSessionsForStudent,
  listSessionsForCourse,
  getLiveAttendance,
};
