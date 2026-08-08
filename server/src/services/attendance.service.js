const pool = require('../config/db');
const env = require('../config/env');
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

// Which of the three checks a given outcome implies. The checks short-circuit in order, so
// anything after the failure genuinely did not run - 'skipped', not 'failed'. Blaming the
// network for a request that never reached the network check would make the audit trail
// worse than having none.
const CHECK_STATE_BY_OUTCOME = {
  SUCCESS: { qr: 'passed', geofence: 'passed', network: 'passed' },
  SESSION_INACTIVE: { qr: 'skipped', geofence: 'skipped', network: 'skipped' },
  QR_INVALID: { qr: 'failed', geofence: 'skipped', network: 'skipped' },
  QR_EXPIRED: { qr: 'failed', geofence: 'skipped', network: 'skipped' },
  GEOFENCE_MISSING_COORDINATES: { qr: 'passed', geofence: 'failed', network: 'skipped' },
  GEOFENCE_OUT_OF_RANGE: { qr: 'passed', geofence: 'failed', network: 'skipped' },
  NETWORK_UNAUTHORISED: { qr: 'passed', geofence: 'passed', network: 'failed' },
  DUPLICATE_SUBMISSION: { qr: 'passed', geofence: 'passed', network: 'passed' },
};

// Resolves a fingerprint to a row in `devices` (ER Figure 4.5), creating it on first sight
// and touching last_seen_at otherwise. ON DUPLICATE KEY rather than SELECT-then-INSERT so two
// students checking in from the same device at the same moment cannot race to create it.
async function upsertDevice(fingerprint) {
  if (!fingerprint) return null;
  try {
    await pool.query(
      `INSERT INTO devices (fingerprint) VALUES (?)
       ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP`,
      [fingerprint]
    );
    const [[row]] = await pool.query('SELECT id FROM devices WHERE fingerprint = ?', [fingerprint]);
    return row ? row.id : null;
  } catch (err) {
    // Same reasoning as the attempt log: device bookkeeping must never cost a student their
    // attendance.
    console.error('[attendance] could not record device:', err.message);
    return null;
  }
}

// Deliberately swallows its own errors. This is a diagnostic side-channel: if writing the
// audit row fails, the student must still get the correct answer about their attendance.
// Losing a log line is a bad day; refusing a valid check-in because of one is a worse one.
async function recordAttempt({ sessionId, studentId, outcome, distance, clientIp, deviceFingerprint }) {
  if (!sessionId || !studentId) return;
  const state = CHECK_STATE_BY_OUTCOME[outcome] || { qr: 'skipped', geofence: 'skipped', network: 'skipped' };
  try {
    await pool.query(
      `INSERT INTO attendance_attempts
        (session_id, student_id, outcome, qr_check, geofence_check, network_check,
         distance_meters, client_ip, device_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        studentId,
        outcome,
        state.qr,
        state.geofence,
        state.network,
        distance ?? null,
        clientIp || null,
        deviceFingerprint || null,
      ]
    );
  } catch (err) {
    console.error('[attendance] could not record attempt:', err.message);
  }
}

// Direct implementation of pseudocode 4.9.2: each check short-circuits on the cheapest
// signal first (QR, then geofence, then network) so an attacker - or an honest mistake -
// never pays for a GPS/network check once a cheaper check has already failed.
async function submitAttendance({ studentId, qrPayload, coordinates, network, deviceFingerprint }) {
  const sessionId = qrPayload?.sessionId;
  if (!sessionId) fail('QR_INVALID');

  // Every exit from here on is logged, not just the happy path. Wrapping the whole body
  // means a reason added later cannot be forgotten in the audit trail.
  const audit = (outcome, distance) =>
    recordAttempt({
      sessionId,
      studentId,
      outcome,
      distance,
      clientIp: network?.clientIp,
      deviceFingerprint,
    });

  const session = await sessionService.getSessionById(sessionId);

  if (!session.is_active || new Date(session.end_time) < new Date()) {
    await audit('SESSION_INACTIVE');
    fail('SESSION_INACTIVE');
  }

  const qrResult = qrService.verifyQrPayload(qrPayload, session);
  if (!qrResult.passed) {
    await audit(qrResult.reason);
    fail(qrResult.reason);
  }

  const geoResult = geofenceService.verifyGeofence(coordinates, session);
  if (!geoResult.passed) {
    await audit(geoResult.reason, geoResult.distance);
    fail(geoResult.reason, { distanceMeters: geoResult.distance });
  }

  const netResult = networkService.verifyNetwork(network, session);
  if (!netResult.passed) {
    await audit(netResult.reason, geoResult.distance);
    fail(netResult.reason);
  }

  // Resolved before the transaction opens: it is its own small write, and holding the
  // attendance transaction open across it would widen the lock for no benefit.
  const deviceId = await upsertDevice(deviceFingerprint);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query(
      'SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ? FOR UPDATE',
      [sessionId, studentId]
    );
    if (existing.length > 0) {
      await connection.rollback();
      await audit('DUPLICATE_SUBMISSION', geoResult.distance);
      fail('DUPLICATE_SUBMISSION');
    }

    const [insertResult] = await connection.query(
      `INSERT INTO attendance_records
        (session_id, student_id, latitude, longitude, qr_check_passed, geofence_check_passed,
         network_check_passed, distance_meters, device_fingerprint, device_id)
       VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?, ?)`,
      [
        sessionId,
        studentId,
        // FR07: the position itself, alongside the distance derived from it.
        coordinates.lat,
        coordinates.lng,
        geoResult.distance,
        deviceFingerprint || null,
        deviceId,
      ]
    );

    await connection.commit();
    await audit('SUCCESS', geoResult.distance);
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
      await audit('DUPLICATE_SUBMISSION', geoResult.distance);
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

  // Numerator and denominator must be drawn from the same session set, or the ratio can be
  // wrong in both directions: a session that has started but not yet ended would count in
  // an "all records ever" numerator without counting in an "ended sessions" denominator
  // (understating attendance, even showing 0% for a just-recorded check-in), while a student
  // with more records than concluded sessions could show over 100%. Joining once, per
  // session-that-has-started, keeps both sides consistent.
  const [[{ totalEnrolledSessions, attendedSessions }]] = await pool.query(
    `SELECT COUNT(*) AS totalEnrolledSessions, SUM(ar.id IS NOT NULL) AS attendedSessions
     FROM sessions s
     JOIN enrolments e ON e.course_id = s.course_id AND e.student_id = ?
     LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.student_id = ?
     WHERE s.start_time <= NOW()
       AND s.start_time >= e.enrolment_date`,
    [studentId, studentId]
  );

  const attendancePercentage = percentage(attendedSessions, totalEnrolledSessions);

  return { records: rows, totalEnrolledSessions, attendedSessions, attendancePercentage };
}

function percentage(attended, total) {
  return total > 0 ? Math.round((attended / total) * 1000) / 10 : 0;
}

// How many consecutive future sessions the student may miss while staying at or above the
// floor:  attended / (total + k) >= min  ->  k <= attended/min - total
function sessionsCanMiss(attended, total, min) {
  if (min <= 0) return Infinity;
  return Math.max(0, Math.floor(attended / (min / 100) - total));
}

// ...and, when already below it, how many consecutive future sessions they must attend to
// climb back:  (attended + k) / (total + k) >= min  ->  k >= (min*total - attended) / (1 - min)
function sessionsToRecover(attended, total, min) {
  if (min >= 100) return Infinity;
  const m = min / 100;
  return Math.max(0, Math.ceil((m * total - attended) / (1 - m)));
}

// Per-course breakdown. "What is my attendance?" is not actually answerable by one number -
// a student passing overall can still be below the floor in the single course that matters,
// and the old dashboard could not surface that at all.
async function getSummaryForStudent(studentId) {
  const min = env.minimumAttendancePercent;

  // Returned alongside the figures so the dashboard can identify who it is talking to
  // without a second round trip, the same way the teacher's overview carries department.
  const [[profile]] = await pool.query(
    `SELECT u.name, s.student_number, s.program, s.semester, s.section
     FROM users u LEFT JOIN students s ON s.user_id = u.id
     WHERE u.id = ?`,
    [studentId]
  );

  const [courses] = await pool.query(
    // Sessions held before the student enrolled are excluded deliberately: marking someone
    // absent for a class they were not yet registered for is not a record, it is a penalty.
    `SELECT c.id, c.course_name, c.course_code, u.name AS teacher_name,
            COUNT(s.id)                 AS totalSessions,
            SUM(ar.id IS NOT NULL)      AS attendedSessions,
            MAX(ar.submitted_at)        AS lastAttendedAt
     FROM enrolments e
     JOIN courses c ON c.id = e.course_id
     LEFT JOIN users u ON u.id = c.teacher_id
     LEFT JOIN sessions s
            ON s.course_id = c.id
           AND s.start_time <= NOW()
           AND s.start_time >= e.enrolment_date
     LEFT JOIN attendance_records ar
            ON ar.session_id = s.id
           AND ar.student_id = e.student_id
     WHERE e.student_id = ?
     GROUP BY c.id, c.course_name, c.course_code, u.name
     ORDER BY c.course_name`,
    [studentId]
  );

  const perCourse = courses.map((row) => {
    const attended = Number(row.attendedSessions || 0);
    const total = Number(row.totalSessions || 0);
    const pct = percentage(attended, total);
    return {
      courseId: row.id,
      courseName: row.course_name,
      courseCode: row.course_code,
      teacherName: row.teacher_name,
      totalSessions: total,
      attendedSessions: attended,
      missedSessions: total - attended,
      attendancePercentage: pct,
      lastAttendedAt: row.lastAttendedAt,
      // A course with no sessions yet is not "at risk" - it has nothing to be at risk about.
      atRisk: total > 0 && pct < min,
      canMiss: sessionsCanMiss(attended, total, min),
      mustAttend: total > 0 && pct < min ? sessionsToRecover(attended, total, min) : 0,
    };
  });

  const totalSessions = perCourse.reduce((sum, c) => sum + c.totalSessions, 0);
  const attendedSessions = perCourse.reduce((sum, c) => sum + c.attendedSessions, 0);
  const overallPct = percentage(attendedSessions, totalSessions);

  const [[nextSession]] = await pool.query(
    `SELECT s.id, s.start_time, s.end_time, c.course_name, c.course_code
     FROM sessions s
     JOIN courses c ON c.id = s.course_id
     JOIN enrolments e ON e.course_id = c.id AND e.student_id = ?
     WHERE s.is_active = 1 AND s.start_time > NOW()
     ORDER BY s.start_time
     LIMIT 1`,
    [studentId]
  );

  return {
    student: {
      name: profile?.name,
      studentNumber: profile?.student_number,
      program: profile?.program,
      semester: profile?.semester,
      section: profile?.section,
    },
    minimumAttendancePercent: min,
    overall: {
      totalSessions,
      attendedSessions,
      missedSessions: totalSessions - attendedSessions,
      attendancePercentage: overallPct,
      meetsMinimum: totalSessions === 0 || overallPct >= min,
      canMiss: sessionsCanMiss(attendedSessions, totalSessions, min),
      mustAttend:
        totalSessions > 0 && overallPct < min
          ? sessionsToRecover(attendedSessions, totalSessions, min)
          : 0,
    },
    courses: perCourse,
    nextSession: nextSession || null,
  };
}

module.exports = { submitAttendance, getHistoryForStudent, getSummaryForStudent };
