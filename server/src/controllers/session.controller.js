const asyncHandler = require('../utils/asyncHandler');
const sessionService = require('../services/session.service');
const qrService = require('../services/qr.service');

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
    geofenceLat,
    geofenceLng,
    geofenceRadiusM,
    authorisedSsid,
    authorisedSubnet,
    startTime,
    endTime,
  } = req.body;

  const session = await sessionService.createSession({
    courseId,
    teacherId: req.user.id,
    geofenceLat,
    geofenceLng,
    geofenceRadiusM,
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

module.exports = { create, getQr, end, live, activeForStudent };
