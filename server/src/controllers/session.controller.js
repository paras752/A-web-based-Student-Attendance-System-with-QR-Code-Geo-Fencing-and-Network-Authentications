const asyncHandler = require('../utils/asyncHandler');
const sessionService = require('../services/session.service');
const qrService = require('../services/qr.service');
const { ApiError } = require('../middleware/errorHandler');

// qr_secret is used internally (Section 3.2.2) to sign/verify QR payloads but must never
// leave the server: exposing it - even to the owning teacher's own browser tab - would let
// anyone with access to that response mint valid attendance QR codes outside the normal,
// rate-limited generation endpoint.
function toPublicSession(session) {
  const { qr_secret, ...publicFields } = session;
  return publicFields;
}

const create = asyncHandler(async (req, res) => {
  const {
    courseId,
    room,
    geofenceLat,
    geofenceLng,
    geofenceRadiusM,
    qrValiditySeconds,
    authorisedSsid,
    authorisedSubnet,
    startTime,
    endTime,
  } = req.body;

  const session = await sessionService.createSession({
    courseId,
    teacherId: req.user.id,
    room,
    geofenceLat,
    geofenceLng,
    geofenceRadiusM,
    qrValiditySeconds,
    authorisedSsid,
    authorisedSubnet,
    startTime,
    endTime,
  });
  res.status(201).json({ session: toPublicSession(session) });
});

const getQr = asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.id);
  const session = await sessionService.assertTeacherOwnsSession(sessionId, req.user.id);

  // A QR is a signed credential. Attendance verification already refuses an inactive
  // session, so an ended session's code could not be redeemed - but minting one anyway means
  // the screen shows a scannable code for a class that is over, which is how a teacher ends
  // up believing a finished session is still running.
  const finished = !session.is_active || new Date(session.end_time) < new Date();
  if (finished) {
    throw new ApiError(409, 'This session has ended, so no new QR code can be issued');
  }

  const qr = await qrService.generateSignedQrImage(session);
  res.json({ qr });
});

const end = asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.id);
  const session = await sessionService.endSession(sessionId, req.user.id);
  res.json({ session: toPublicSession(session) });
});

const live = asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.id);
  const result = await sessionService.getLiveAttendance(sessionId, req.user.id);
  res.json({ ...result, session: toPublicSession(result.session) });
});

const activeForStudent = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listActiveSessionsForStudent(req.user.id);
  res.json({ sessions });
});

const markAttendance = asyncHandler(async (req, res) => {
  const result = await sessionService.markAttendanceManually({
    sessionId: Number(req.params.id),
    studentId: Number(req.body.studentId),
    teacherId: req.user.id,
    reason: req.body.reason,
  });
  res.status(201).json(result);
});

const unmarkAttendance = asyncHandler(async (req, res) => {
  await sessionService.removeManualMark({
    sessionId: Number(req.params.id),
    studentId: Number(req.params.studentId),
    teacherId: req.user.id,
  });
  res.status(204).send();
});

const teacherOverview = asyncHandler(async (req, res) => {
  const overview = await sessionService.getTeacherOverview(req.user.id);
  res.json(overview);
});

const mySessions = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listSessionsForTeacher(req.user.id, {
    query: req.query.q,
    status: req.query.status,
  });
  res.json({ sessions });
});

const myCourses = asyncHandler(async (req, res) => {
  const courses = await sessionService.listCourseStatsForTeacher(req.user.id);
  res.json({ courses });
});

module.exports = {
  create,
  getQr,
  end,
  live,
  activeForStudent,
  teacherOverview,
  mySessions,
  myCourses,
  markAttendance,
  unmarkAttendance,
};
