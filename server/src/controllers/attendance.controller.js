const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const attendanceService = require('../services/attendance.service');
const { normaliseIp } = require('../utils/subnet');

function fingerprintDevice(req) {
  const ua = req.headers['user-agent'] || '';
  const ip = normaliseIp(req.ip);
  return crypto.createHash('sha256').update(`${ip}::${ua}`).digest('hex').slice(0, 32);
}

const verify = asyncHandler(async (req, res) => {
  const { qrPayload, coordinates } = req.body;
  // Note what is NOT read from the body: any claim about the caller's network. The source IP
  // is taken from the connection itself, because that is the one part of the request the
  // caller cannot choose.
  const clientIp = normaliseIp(req.ip);

  const result = await attendanceService.submitAttendance({
    studentId: req.user.id,
    qrPayload,
    coordinates,
    network: { clientIp },
    deviceFingerprint: fingerprintDevice(req),
  });

  res.status(201).json(result);
});

const history = asyncHandler(async (req, res) => {
  const result = await attendanceService.getHistoryForStudent(req.user.id);
  res.json(result);
});

const summary = asyncHandler(async (req, res) => {
  const result = await attendanceService.getSummaryForStudent(req.user.id);
  res.json(result);
});

module.exports = { verify, history, summary };
