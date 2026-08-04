const pool = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');
const sessionService = require('./session.service');
const qrService = require('./qr.service');
const geofenceService = require('./geofence.service');
const networkService = require('./network.service');

const FAILURE_STATUS = {
  SESSION_INACTIVE: 400,
  QR_EXPIRED: 400,
  QR_INVALID: 400,
  GEOFENCE_MISSING_COORDINATES: 400,
  GEOFENCE_OUT_OF_RANGE: 403,
  NETWORK_UNAUTHORISED: 403,
  DUPLICATE_SUBMISSION: 409,
};

function fail(reason, extra) {
  const status = FAILURE_STATUS[reason] || 400;
  const err = new ApiError(status, reason, extra);
  err.reason = reason;
  throw err;
}

// Direct implementation of pseudocode 4.9.2: each check short-circuits on the cheapest
// signal first (QR, then geofence, then network) so an attacker - or an honest mistake -
// never pays for a GPS/network check once a cheaper check has already failed.
async function submitAttendance({ studentId, qrPayload, coordinates, network, deviceFingerprint }) {
  const sessionId = qrPayload?.sessionId;
  if (!sessionId) fail('QR_INVALID');

  const session = await sessionService.getSessionById(sessionId);

  if (!session.is_active || new Date(session.end_time) < new Date()) {
    fail('SESSION_INACTIVE');
  }

  const qrResult = qrService.verifyQrPayload(qrPayload, session);
  if (!qrResult.passed) fail(qrResult.reason);

  const geoResult = geofenceService.verifyGeofence(coordinates, session);
  if (!geoResult.passed) fail(geoResult.reason, { distanceMeters: geoResult.distance });

  const netResult = networkService.verifyNetwork(network, session);
  if (!netResult.passed) fail(netResult.reason);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query(
      'SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ? FOR UPDATE',
      [sessionId, studentId]
    );
    if (existing.length > 0) {
      await connection.rollback();
      fail('DUPLICATE_SUBMISSION');
    }

    const [insertResult] = await connection.query(
      `INSERT INTO attendance_records
        (session_id, student_id, qr_check_passed, geofence_check_passed, network_check_passed,
         distance_meters, device_fingerprint)
       VALUES (?, ?, 1, 1, 1, ?, ?)`,
      [sessionId, studentId, geoResult.distance, deviceFingerprint || null]
    );

    await connection.commit();
    return {
      recordId: insertResult.insertId,
      status: 'ATTENDANCE_RECORDED',
      distanceMeters: geoResult.distance,
    };
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (_) {
        /* connection already rolled back or closed */
      }
    }
    // Unique-key constraint is the last-resort guard against a race between two near-
    // simultaneous submissions (Section 4.9.2).
    if (err.code === 'ER_DUP_ENTRY') {
      fail('DUPLICATE_SUBMISSION');
    }
    throw err;
  } finally {
    connection.release();
  }
}

async function getHistoryForStudent(studentId) {
  const [rows] = await pool.query(
    `SELECT ar.id, ar.session_id, ar.submitted_at, ar.distance_meters,
            c.course_name, c.course_code, s.start_time
     FROM attendance_records ar
     JOIN sessions s ON s.id = ar.session_id
     JOIN courses c ON c.id = s.course_id
     WHERE ar.student_id = ?
     ORDER BY ar.submitted_at DESC`,
    [studentId]
  );

  const [[{ totalEnrolledSessions }]] = await pool.query(
    `SELECT COUNT(*) AS totalEnrolledSessions
     FROM sessions s
     JOIN enrolments e ON e.course_id = s.course_id AND e.student_id = ?
     WHERE s.end_time < NOW()`,
    [studentId]
  );

  const attendancePercentage =
    totalEnrolledSessions > 0 ? Math.round((rows.length / totalEnrolledSessions) * 1000) / 10 : 0;

  return { records: rows, totalEnrolledSessions, attendancePercentage };
}

module.exports = { submitAttendance, getHistoryForStudent };
