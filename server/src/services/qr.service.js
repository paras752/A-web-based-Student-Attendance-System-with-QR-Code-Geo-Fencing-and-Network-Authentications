const crypto = require('crypto');
const QRCode = require('qrcode');
const pool = require('../config/db');
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
// The window is the session's own setting, falling back to the server default for any row
// created before it was configurable. Read in one place so generation and verification can
// never disagree about how long a code lives.
function validitySecondsFor(session) {
  const configured = Number(session?.qr_validity_seconds);
  return Number.isFinite(configured) && configured > 0 ? configured : env.qrValidityWindowSeconds;
}

async function generateSignedQrImage(session) {
  const timestamp = Date.now();
  const signature = computeSignature(session.qr_secret, session.id, timestamp);
  const payload = { sessionId: session.id, timestamp, signature };
  const validitySeconds = validitySecondsFor(session);

  const dataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });

  const expiresAt = timestamp + validitySeconds * 1000;

  // Issuance log (ER Figure 4.5, QR-CODE entity). The code VALUE is deliberately not stored:
  // it is a live credential, and a table of them would be a list of tokens that work.
  // Verification recomputes the HMAC from the session secret, so nothing needs to look it up.
  // Failure here must not stop a class, so it is logged and swallowed.
  try {
    await pool.query(
      'INSERT INTO qr_codes (session_id, generated_at, expires_at) VALUES (?, FROM_UNIXTIME(?/1000), FROM_UNIXTIME(?/1000))',
      [session.id, timestamp, expiresAt]
    );
  } catch (err) {
    console.error('[qr] could not record issuance:', err.message);
  }

  return {
    imageDataUrl: dataUrl,
    payload,
    validitySeconds,
    expiresAt,
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
  const windowMs = validitySecondsFor(session) * 1000;
  // The negative bound rejects a timestamp from the future - a clock-skewed or hand-crafted
  // payload trying to buy itself a longer life than the window allows.
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
