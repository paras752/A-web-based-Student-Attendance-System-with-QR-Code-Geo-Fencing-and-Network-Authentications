const crypto = require('crypto');
const QRCode = require('qrcode');
const env = require('../config/env');

function computeSignature(qrSecret, sessionId, timestamp) {
  return crypto
    .createHmac('sha256', qrSecret)
    .update(`${sessionId}${timestamp}`)
    .digest('hex');
}

// Generates a fresh signed payload every time it's called; the teacher's Live Session page
// re-fetches this on an interval so the on-screen QR image rolls over automatically
// (Section 3.2.2 / 4.8.2: 30-second dynamic QR to make a screenshot unusable shortly after capture).
async function generateSignedQrImage(session) {
  const timestamp = Date.now();
  const signature = computeSignature(session.qr_secret, session.id, timestamp);
  const payload = { sessionId: session.id, timestamp, signature };

  const dataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });

  return {
    imageDataUrl: dataUrl,
    payload,
    expiresAt: timestamp + env.qrValidityWindowSeconds * 1000,
  };
}

// Mirrors pseudocode 4.9.3 (VerifyQr) exactly: expiry is checked before the signature is
// recomputed server-side, and the recomputed signature - never anything the client asserts -
// is what is trusted.
function verifyQrPayload(payload, session) {
  if (!payload || typeof payload.timestamp !== 'number' || !payload.signature) {
    return { passed: false, reason: 'QR_INVALID' };
  }

  if (Number(payload.sessionId) !== Number(session.id)) {
    return { passed: false, reason: 'QR_INVALID' };
  }

  const elapsedMs = Date.now() - payload.timestamp;
  const windowMs = env.qrValidityWindowSeconds * 1000;
  if (elapsedMs > windowMs || elapsedMs < -5000) {
    return { passed: false, reason: 'QR_EXPIRED' };
  }

  const expectedSignature = computeSignature(session.qr_secret, session.id, payload.timestamp);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const givenBuffer = Buffer.from(String(payload.signature), 'hex');

  const signaturesMatch =
    expectedBuffer.length === givenBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, givenBuffer);

  if (!signaturesMatch) {
    return { passed: false, reason: 'QR_INVALID' };
  }

  return { passed: true };
}

module.exports = { generateSignedQrImage, verifyQrPayload };
