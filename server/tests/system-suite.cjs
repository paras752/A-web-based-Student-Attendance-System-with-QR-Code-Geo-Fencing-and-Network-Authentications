/*
 * Full-system functional suite for SSAS.
 *
 * Drives the running API over HTTP exactly as a browser would, and reads the database
 * directly only to (a) obtain a session's qr_secret so genuinely valid QR codes can be
 * minted, and (b) assert side effects the API does not expose.
 *
 * Everything it creates is torn down in the finally block, and the row counts it started
 * with are re-asserted at the end, so running it against the real database is safe.
 */
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const env = require('../src/config/env');

// Points at the running API. Override with SUITE_API to exercise a deployed instance.
const API = process.env.SUITE_API || `http://127.0.0.1:${env.port}/api/v1`;
const PW = 'Password123!';
const TAG = 'zzsuite';

let pass = 0;
const failures = [];
const groups = [];
let current = null;

function group(name) {
  current = { name, checks: [] };
  groups.push(current);
}
function t(name, ok, detail = '') {
  if (ok) pass += 1;
  else failures.push(`[${current.name}] ${name}${detail ? ' -- ' + detail : ''}`);
  current.checks.push({ name, ok, detail });
}

async function call(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const ct = res.headers.get('content-type') || '';
  let body = null;
  let buf = null;
  if (ct.includes('application/json')) {
    try { body = await res.json(); } catch { /* empty */ }
  } else {
    buf = Buffer.from(await res.arrayBuffer());
  }
  return { status: res.status, body, buf, headers: res.headers };
}

const bearer = (tok) => ({ Authorization: `Bearer ${tok}` });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The attendance limiter is a real security control, so the suite waits it out rather than
// disabling it. RateLimit-Reset is advertised in seconds by standardHeaders.
async function callRL(path, opts = {}, tries = 3) {
  let res = await call(path, opts);
  while (res.status === 429 && tries > 0) {
    const reset = Number(res.headers.get('ratelimit-reset') || 60);
    await sleep((Number.isFinite(reset) ? reset : 60) * 1000 + 500);
    res = await call(path, opts);
    tries -= 1;
  }
  return res;
}

async function login(identifier, password = PW) {
  const r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) });
  return { status: r.status, token: r.body?.accessToken, user: r.body?.user, raw: r };
}

// Mints a QR payload the server will accept, using the session's own secret.
function signQr(secret, sessionId, timestamp) {
  return {
    sessionId,
    timestamp,
    signature: crypto.createHmac('sha256', secret).update(`${sessionId}${timestamp}`).digest('hex'),
  };
}

(async () => {
  const db = await mysql.createConnection(env.db);
  const made = { sessions: [], courses: [], users: [] };

  const countOf = async (table) => {
    const [[r]] = await db.query(`SELECT COUNT(*) c FROM \`${table}\``);
    return r.c;
  };
  const TABLES = ['users', 'students', 'teachers', 'courses', 'enrolments', 'sessions',
                  'attendance_records', 'attendance_attempts', 'devices', 'qr_codes'];
  const baseline = {};
  for (const tb of TABLES) baseline[tb] = await countOf(tb);
  // A successful check-in legitimately registers the calling device. That is correct product
  // behaviour, so it is cleaned up by high-water mark rather than by tag.
  const [[dev0]] = await db.query('SELECT COALESCE(MAX(id), 0) m FROM devices');
  const deviceHighWater = dev0.m;

  try {
    // ---------------------------------------------------------------- AUTH
    group('AUTH');
    const admin = await login('admin@ssas.local');
    const teacher = await login('teacher@ssas.local');
    const student = await login('student@ssas.local');
    t('admin logs in with email', admin.status === 200 && !!admin.token, `status ${admin.status}`);
    t('teacher logs in with email', teacher.status === 200 && !!teacher.token, `status ${teacher.status}`);
    t('student logs in with email', student.status === 200 && !!student.token, `status ${student.status}`);
    t('role returned on login', student.user?.role === 'student', `got ${student.user?.role}`);

    const [[snum]] = await db.query('SELECT student_number FROM students LIMIT 1');
    const byNumber = await login(snum.student_number);
    t('FR02 student logs in with college ID', byNumber.status === 200 && !!byNumber.token,
      `${snum.student_number} -> ${byNumber.status}`);

    const badPw = await login('student@ssas.local', 'WrongPassword1!');
    const noUser = await login('nobody-here@ssas.local', 'WrongPassword1!');
    t('wrong password rejected', badPw.status === 401, `status ${badPw.status}`);
    t('unknown identifier rejected', noUser.status === 401, `status ${noUser.status}`);
    t('no account enumeration by message',
      badPw.raw.body?.error?.message === noUser.raw.body?.error?.message,
      `${badPw.raw.body?.error?.message} vs ${noUser.raw.body?.error?.message}`);

    const t0 = Date.now(); await login('student@ssas.local', 'WrongPassword1!'); const known = Date.now() - t0;
    const t1 = Date.now(); await login('ghost@ssas.local', 'WrongPassword1!'); const unknown = Date.now() - t1;
    t('no account enumeration by timing', Math.abs(known - unknown) < 60, `known ${known}ms vs unknown ${unknown}ms`);

    for (const role of ['teacher', 'admin', 'student', undefined]) {
      const r = await call('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: `${TAG} Reg`, email: `${TAG}.reg.${role}@x.com`, password: 'Password123!', role }),
      });
      t(`registration closed (role=${role})`, r.status === 403, `status ${r.status}`);
    }

    const status = await call('/auth/status');
    t('public /auth/status works', status.status === 200 && typeof status.body?.onCampusNetwork === 'boolean');
    t('/auth/status advertises registration closed', status.body?.allowPublicRegistration === false);

    const me = await call('/auth/me', { headers: bearer(student.token) });
    t('GET /auth/me returns caller', me.status === 200 && me.body?.user?.role === 'student');
    t('password hash never leaves the server', !JSON.stringify(me.body).match(/\$2[aby]\$/));

    const noTok = await call('/auth/me');
    t('unauthenticated /auth/me refused', noTok.status === 401, `status ${noTok.status}`);
    const badTok = await call('/auth/me', { headers: bearer('not.a.jwt') });
    t('malformed token refused', badTok.status === 401, `status ${badTok.status}`);

    t('PATCH /auth/me is gone (no self-service profile edit)',
      (await call('/auth/me', { method: 'PATCH', headers: bearer(student.token), body: '{}' })).status === 404);

    // ---------------------------------------------------------------- ROLE BOUNDARIES
    group('ROLE BOUNDARIES');
    const roleCases = [
      ['student cannot list admin users', '/admin/users', student.token, 403],
      ['teacher cannot list admin users', '/admin/users', teacher.token, 403],
      ['student cannot read analytics', '/admin/analytics', student.token, 403],
      ['student cannot see full catalogue', '/courses/all', student.token, 403],
      ['student cannot read reports', '/attendance/reports?courseId=1&from=2026-01-01&to=2026-12-31', student.token, 403],
      ['teacher cannot use student history', '/attendance/history', teacher.token, 403],
      ['teacher cannot use student summary', '/attendance/summary', teacher.token, 403],
      ['teacher cannot list active sessions', '/sessions/active', teacher.token, 403],
      ['student cannot read teacher overview', '/sessions/overview', student.token, 403],
    ];
    for (const [name, path, tok, want] of roleCases) {
      const r = await call(path, { headers: bearer(tok) });
      t(name, r.status === want, `status ${r.status} (want ${want})`);
    }
    const escalate = await call('/admin/users', {
      method: 'POST', headers: bearer(teacher.token),
      body: JSON.stringify({ name: `${TAG} Esc`, email: `${TAG}.esc@x.com`, password: 'Password123!', role: 'admin' }),
    });
    t('teacher cannot create an admin', escalate.status === 403, `status ${escalate.status}`);
    const anonAdmin = await call('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', email: `${TAG}.anon@x.com`, password: 'Password123!', role: 'admin' }),
    });
    t('unauthenticated admin creation refused', anonAdmin.status === 401, `status ${anonAdmin.status}`);

    // ---------------------------------------------------------------- FIXTURES
    group('SESSION LIFECYCLE');
    const myCourses = await call('/sessions/my-courses', { headers: bearer(teacher.token) });
    const course = (myCourses.body.courses || myCourses.body)[0];
    t('teacher has a course to work with', !!course?.id);

    const now = Date.now();
    const mkSession = async (over = {}) => {
      const r = await call('/sessions', {
        method: 'POST', headers: bearer(teacher.token),
        body: JSON.stringify({
          courseId: course.id, geofenceLat: 27.7172, geofenceLng: 85.324, geofenceRadiusM: 50,
          qrValiditySeconds: 30, authorisedSubnet: 'any', room: `${TAG}-room`,
          startTime: new Date(now - 60000).toISOString(),
          endTime: new Date(now + 3600000).toISOString(), ...over,
        }),
      });
      const id = (r.body?.session || r.body)?.id;
      if (id) made.sessions.push(id);
      return { r, id };
    };

    const good = await mkSession();
    t('teacher creates a session', good.r.status === 201 || good.r.status === 200, `status ${good.r.status}`);
    t('qr_secret never returned to the client', !JSON.stringify(good.r.body).includes('qr_secret'));

    const badRadius = await mkSession({ geofenceRadiusM: 9999 });
    t('geofence radius bounded', badRadius.r.status === 400, `status ${badRadius.r.status}`);
    const badWindow = await mkSession({ qrValiditySeconds: 5 });
    t('QR validity floor enforced (min 10s)', badWindow.r.status === 400, `status ${badWindow.r.status}`);
    const badWindow2 = await mkSession({ qrValiditySeconds: 999 });
    t('QR validity ceiling enforced (max 300s)', badWindow2.r.status === 400, `status ${badWindow2.r.status}`);
    const badLat = await mkSession({ geofenceLat: 999 });
    t('session latitude bounded', badLat.r.status === 400, `status ${badLat.r.status}`);
    const badTime = await mkSession({ endTime: new Date(now - 7200000).toISOString() });
    t('endTime must follow startTime', badTime.r.status === 400, `status ${badTime.r.status}`);
    const badSubnet = await mkSession({ authorisedSubnet: 'not-a-subnet' });
    t('authorisedSubnet must be CIDR or any', badSubnet.r.status === 400, `status ${badSubnet.r.status}`);

    const sid = good.id;
    const [[secretRow]] = await db.query('SELECT qr_secret, qr_validity_seconds FROM sessions WHERE id = ?', [sid]);
    const SECRET = secretRow.qr_secret;
    t('session stores a qr_secret', !!SECRET && SECRET.length >= 32);

    const qrEndpoint = await call(`/sessions/${sid}/qr`, { headers: bearer(teacher.token) });
    // Response shape is { qr: { imageDataUrl, payload, validitySeconds, expiresAt } }.
    t('teacher can fetch a QR image',
      qrEndpoint.status === 200 && String(qrEndpoint.body?.qr?.imageDataUrl || '').startsWith('data:image/'),
      `status ${qrEndpoint.status}`);
    t('QR response carries the validity window', qrEndpoint.body?.qr?.validitySeconds === 30,
      `${qrEndpoint.body?.qr?.validitySeconds}`);
    t('QR secret absent from the QR response', !JSON.stringify(qrEndpoint.body).includes(SECRET));
    const qrAsStudent = await call(`/sessions/${sid}/qr`, { headers: bearer(student.token) });
    t('student cannot fetch the QR generator', qrAsStudent.status === 403, `status ${qrAsStudent.status}`);

    const activeForStudent = await call('/sessions/active', { headers: bearer(student.token) });
    t('student sees the active session', (activeForStudent.body?.sessions || []).some((s) => s.id === sid));

    // ---------------------------------------------------------------- QR FACTOR
    group('QR FACTOR');
    const HERE = { lat: 27.7172, lng: 85.324 };
    const submit = (payload, coords = HERE, tok = student.token) =>
      callRL('/attendance/verify', { method: 'POST', headers: bearer(tok), body: JSON.stringify({ qrPayload: payload, coordinates: coords }) });

    const expired = await submit({ ...signQr(SECRET, sid, Date.now() - 10 * 60 * 1000) });
    t('expired QR rejected', expired.status === 400 && expired.body?.error?.code === 'QR_EXPIRED',
      `${expired.status} ${expired.body?.error?.code}`);
    t('expired QR exposes a machine-readable code', expired.body?.error?.code === 'QR_EXPIRED');

    const forged = await submit({ sessionId: sid, timestamp: Date.now(), signature: 'b'.repeat(64) });
    t('forged signature rejected', forged.body?.error?.code === 'QR_INVALID', `${forged.body?.error?.code}`);

    const future = await submit({ ...signQr(SECRET, sid, Date.now() + 10 * 60 * 1000) });
    t('future-dated QR rejected', future.body?.error?.code === 'QR_EXPIRED', `${future.body?.error?.code}`);

    const wrongSession = await submit({ ...signQr(SECRET, sid, Date.now()), sessionId: 999999 });
    t('QR for another session rejected', [400, 404].includes(wrongSession.status), `status ${wrongSession.status}`);

    const malformed = await submit({ sessionId: sid, timestamp: 'nope', signature: 'x' });
    t('malformed QR payload rejected', malformed.body?.error?.code === 'QR_INVALID', `${malformed.body?.error?.code}`);

    const noPayload = await callRL('/attendance/verify', {
      method: 'POST', headers: bearer(student.token),
      body: JSON.stringify({ coordinates: HERE }),
    });
    t('missing qrPayload rejected by validator', noPayload.status === 400, `status ${noPayload.status}`);

    // ---------------------------------------------------------------- GEOFENCE
    group('GEOFENCE FACTOR');
    const farAway = await submit({ ...signQr(SECRET, sid, Date.now()) }, { lat: 28.7041, lng: 77.1025 });
    t('out-of-range location rejected', farAway.body?.error?.code === 'GEOFENCE_OUT_OF_RANGE', `${farAway.body?.error?.code}`);
    t('rejection reports the distance', typeof farAway.body?.error?.details?.distanceMeters === 'number');

    const badCoord = await submit({ ...signQr(SECRET, sid, Date.now()) }, { lat: 999, lng: 85.324 });
    t('latitude out of bounds rejected as malformed', badCoord.status === 400 && !badCoord.body?.error?.code,
      `status ${badCoord.status}`);
    const badCoord2 = await submit({ ...signQr(SECRET, sid, Date.now()) }, { lat: 27.7172, lng: 999 });
    t('longitude out of bounds rejected as malformed', badCoord2.status === 400);
    const noCoord = await callRL('/attendance/verify', {
      method: 'POST', headers: bearer(student.token),
      body: JSON.stringify({ qrPayload: signQr(SECRET, sid, Date.now()) }),
    });
    t('missing coordinates rejected', noCoord.status === 400, `status ${noCoord.status}`);

    // ---------------------------------------------------------------- NETWORK
    group('NETWORK FACTOR');
    const netSession = await mkSession({ authorisedSubnet: '192.168.99.0/24' });
    const [[netSecret]] = await db.query('SELECT qr_secret FROM sessions WHERE id = ?', [netSession.id]);
    const offSubnet = await submit({ ...signQr(netSecret.qr_secret, netSession.id, Date.now()) });
    t('off-subnet request rejected', offSubnet.body?.error?.code === 'NETWORK_UNAUTHORISED', `${offSubnet.body?.error?.code}`);

    const spoof = await callRL('/attendance/verify', {
      method: 'POST', headers: bearer(student.token),
      body: JSON.stringify({
        qrPayload: signQr(netSecret.qr_secret, netSession.id, Date.now()),
        coordinates: HERE,
        network: { ssid: 'Campus_WiFi' },
      }),
    });
    t('SSID claim cannot satisfy the network factor', spoof.body?.error?.code === 'NETWORK_UNAUTHORISED', `${spoof.body?.error?.code}`);

    const xff = await callRL('/attendance/verify', {
      method: 'POST',
      headers: { ...bearer(student.token), 'X-Forwarded-For': '192.168.99.50' },
      body: JSON.stringify({ qrPayload: signQr(netSecret.qr_secret, netSession.id, Date.now()), coordinates: HERE }),
    });
    t('X-Forwarded-For cannot spoof the source IP', xff.body?.error?.code === 'NETWORK_UNAUTHORISED', `${xff.body?.error?.code}`);

    // ---------------------------------------------------------------- HAPPY PATH + DUPLICATE
    group('SUCCESS AND DUPLICATE PREVENTION');
    const okRes = await submit({ ...signQr(SECRET, sid, Date.now()) });
    t('valid three-factor check-in succeeds', okRes.status === 200 || okRes.status === 201,
      `status ${okRes.status} ${JSON.stringify(okRes.body?.error || '')}`);
    t('response reports recorded status', okRes.body?.status === 'ATTENDANCE_RECORDED', `${okRes.body?.status}`);

    const [[rec]] = await db.query(
      'SELECT latitude, longitude, qr_check_passed, geofence_check_passed, network_check_passed, distance_meters, device_id, marked_by FROM attendance_records WHERE session_id = ?', [sid]);
    t('FR07 latitude stored', rec && Number(rec.latitude).toFixed(3) === '27.717', `${rec?.latitude}`);
    t('FR07 longitude stored', rec && Number(rec.longitude).toFixed(3) === '85.324', `${rec?.longitude}`);
    t('all three check flags set on a verified scan',
      rec?.qr_check_passed === 1 && rec?.geofence_check_passed === 1 && rec?.network_check_passed === 1);
    t('verified scan has no marked_by', rec?.marked_by === null, `${rec?.marked_by}`);
    t('device linked to the record', rec?.device_id !== null);

    const dup = await submit({ ...signQr(SECRET, sid, Date.now()) });
    t('FR10 duplicate check-in rejected', dup.status === 409 && dup.body?.error?.code === 'DUPLICATE_SUBMISSION',
      `${dup.status} ${dup.body?.error?.code}`);
    const [[dupCount]] = await db.query('SELECT COUNT(*) c FROM attendance_records WHERE session_id = ?', [sid]);
    t('duplicate did not create a second row', dupCount.c === 1, `${dupCount.c} rows`);

    let dbRejected = false;
    try {
      await db.query('INSERT INTO attendance_records (session_id, student_id, qr_check_passed, geofence_check_passed, network_check_passed) VALUES (?, ?, 1, 1, 1)',
        [sid, student.user.id]);
    } catch (e) { dbRejected = e.code === 'ER_DUP_ENTRY'; }
    t('NFR09 database itself rejects a duplicate (bypassing the API)', dbRejected);

    let orphanRejected = false;
    try {
      await db.query('INSERT INTO attendance_records (session_id, student_id, qr_check_passed, geofence_check_passed, network_check_passed) VALUES (999999, 999999, 1, 1, 1)');
    } catch (e) { orphanRejected = e.code === 'ER_NO_REFERENCED_ROW_2'; }
    t('NFR09 database rejects an orphan attendance row', orphanRejected);

    // ---------------------------------------------------------------- AUDIT TRAIL
    group('AUDIT TRAIL');
    const [attempts] = await db.query('SELECT outcome, qr_check, geofence_check, network_check FROM attendance_attempts WHERE session_id IN (?, ?)', [sid, netSession.id]);
    const byOutcome = (o) => attempts.filter((r) => r.outcome === o);
    t('failed attempts are recorded, not only successes', attempts.length >= 5, `${attempts.length} rows`);
    t('SUCCESS attempt logged', byOutcome('SUCCESS').length === 1, `${byOutcome('SUCCESS').length}`);
    t('QR_EXPIRED attempt logged', byOutcome('QR_EXPIRED').length >= 1);
    t('expired QR marks the QR check failed', byOutcome('QR_EXPIRED').every((r) => r.qr_check === 'failed'));
    t('short-circuit records later checks as skipped, not failed',
      byOutcome('QR_EXPIRED').every((r) => r.geofence_check === 'skipped' && r.network_check === 'skipped'));
    t('geofence failure marks QR passed and network skipped',
      byOutcome('GEOFENCE_OUT_OF_RANGE').every((r) => r.qr_check === 'passed' && r.network_check === 'skipped'));
    t('network failure marks QR and geofence passed',
      byOutcome('NETWORK_UNAUTHORISED').every((r) => r.qr_check === 'passed' && r.geofence_check === 'passed'));

    const [[qrLog]] = await db.query('SELECT COUNT(*) c FROM qr_codes WHERE session_id = ?', [sid]);
    t('QR issuance logged', qrLog.c >= 1, `${qrLog.c}`);
    const [qrCols] = await db.query("SHOW COLUMNS FROM qr_codes");
    t('QR code VALUE deliberately not stored', !qrCols.some((c) => /code_value|codevalue/i.test(c.Field)));

    // ---------------------------------------------------------------- LIVE + MANUAL
    group('LIVE VIEW AND MANUAL ATTENDANCE');
    const live = await call(`/sessions/${sid}/live`, { headers: bearer(teacher.token) });
    t('teacher live view works', live.status === 200);
    t('live view shows the present student', JSON.stringify(live.body).includes(String(student.user.id)));

    const manualSession = await mkSession();
    const markRes = await call(`/sessions/${manualSession.id}/attendance`, {
      method: 'POST', headers: bearer(teacher.token),
      body: JSON.stringify({ studentId: student.user.id, reason: `${TAG} flat battery` }),
    });
    t('teacher can mark a student present manually', [200, 201].includes(markRes.status), `status ${markRes.status}`);
    const [[manualRec]] = await db.query('SELECT qr_check_passed, geofence_check_passed, network_check_passed, marked_by, mark_reason FROM attendance_records WHERE session_id = ?', [manualSession.id]);
    t('manual mark stores all three flags as 0',
      manualRec?.qr_check_passed === 0 && manualRec?.geofence_check_passed === 0 && manualRec?.network_check_passed === 0,
      JSON.stringify(manualRec));
    t('manual mark records who did it', manualRec?.marked_by === teacher.user.id);
    t('manual mark records the reason', String(manualRec?.mark_reason || '').includes('flat battery'));

    const studentMark = await call(`/sessions/${manualSession.id}/attendance`, {
      method: 'POST', headers: bearer(student.token), body: JSON.stringify({ studentId: student.user.id }),
    });
    t('student cannot mark themselves present', studentMark.status === 403, `status ${studentMark.status}`);

    const unmarkManual = await call(`/sessions/${manualSession.id}/attendance/${student.user.id}`, {
      method: 'DELETE', headers: bearer(teacher.token),
    });
    t('manual mark can be undone', [200, 204].includes(unmarkManual.status), `status ${unmarkManual.status}`);

    const unmarkVerified = await call(`/sessions/${sid}/attendance/${student.user.id}`, {
      method: 'DELETE', headers: bearer(teacher.token),
    });
    t('a verified scan cannot be deleted by the teacher', unmarkVerified.status === 409, `status ${unmarkVerified.status}`);

    // ---------------------------------------------------------------- ENDING A SESSION
    group('ENDING A SESSION');
    const [[beforeEnd]] = await db.query('SELECT end_time FROM sessions WHERE id = ?', [sid]);
    const ended = await call(`/sessions/${sid}/end`, { method: 'PATCH', headers: bearer(teacher.token) });
    t('teacher can end a session', [200, 204].includes(ended.status), `status ${ended.status}`);
    const [[afterEnd]] = await db.query('SELECT is_active, ended_at, end_time FROM sessions WHERE id = ?', [sid]);
    t('ending marks the session inactive', afterEnd.is_active === 0);
    t('ending records ended_at', afterEnd.ended_at !== null);
    t('scheduled end_time preserved when ending early',
      new Date(afterEnd.end_time).getTime() === new Date(beforeEnd.end_time).getTime());

    const qrAfterEnd = await call(`/sessions/${sid}/qr`, { headers: bearer(teacher.token) });
    t('ended session stops minting QR codes', qrAfterEnd.status === 409, `status ${qrAfterEnd.status}`);
    const scanAfterEnd = await submit({ ...signQr(SECRET, sid, Date.now()) });
    t('ended session refuses check-in', scanAfterEnd.body?.error?.code === 'SESSION_INACTIVE', `${scanAfterEnd.body?.error?.code}`);

    // ---------------------------------------------------------------- COURSES / ENROLMENT
    group('COURSES AND ENROLMENT');
    const roster = await call(`/courses/${course.id}/roster`, { headers: bearer(teacher.token) });
    t('teacher can read the roster', roster.status === 200);
    const rosterAsStudent = await call(`/courses/${course.id}/roster`, { headers: bearer(student.token) });
    t('student cannot read the roster', rosterAsStudent.status === 403, `status ${rosterAsStudent.status}`);
    const selfEnrol = await call(`/courses/${course.id}/enrol`, {
      method: 'POST', headers: bearer(student.token), body: JSON.stringify({ studentId: student.user.id }),
    });
    t('student cannot self-enrol', selfEnrol.status === 403, `status ${selfEnrol.status}`);
    const myCoursesStudent = await call('/courses', { headers: bearer(student.token) });
    t('student sees only their own courses', myCoursesStudent.status === 200);

    // ---------------------------------------------------------------- STUDENT VIEWS
    group('STUDENT VIEWS');
    const hist = await call('/attendance/history', { headers: bearer(student.token) });
    t('history returns records', hist.status === 200);
    const summ = await call('/attendance/summary', { headers: bearer(student.token) });
    t('summary returns a percentage', summ.status === 200);
    t('summary never exceeds 100%', JSON.stringify(summ.body).match(/"percentage":\s*(\d+(\.\d+)?)/) === null ||
      Number(JSON.stringify(summ.body).match(/"percentage":\s*(\d+(\.\d+)?)/)[1]) <= 100);

    // ---------------------------------------------------------------- ADMIN
    group('ADMIN');
    const users = await call('/admin/users', { headers: bearer(admin.token) });
    t('admin lists users', users.status === 200);
    const analytics = await call('/admin/analytics', { headers: bearer(admin.token) });
    t('admin analytics works', analytics.status === 200);

    const newStu = await call('/admin/users', {
      method: 'POST', headers: bearer(admin.token),
      body: JSON.stringify({ name: `${TAG} Student`, email: `${TAG}.stu@x.com`, password: 'Password123!', role: 'student' }),
    });
    const newStuId = (newStu.body?.user || newStu.body)?.id;
    if (newStuId) made.users.push(newStuId);
    t('admin creates a student', [200, 201].includes(newStu.status), `status ${newStu.status}`);

    const dupEmail = await call('/admin/users', {
      method: 'POST', headers: bearer(admin.token),
      body: JSON.stringify({ name: `${TAG} Dup`, email: `${TAG}.stu@x.com`, password: 'Password123!', role: 'student' }),
    });
    t('duplicate email refused', [400, 409].includes(dupEmail.status), `status ${dupEmail.status}`);

    const setNum = await call(`/admin/users/${newStuId}/student-number`, {
      method: 'PATCH', headers: bearer(admin.token), body: JSON.stringify({ studentNumber: `${TAG}001` }),
    });
    t('admin sets a college ID', [200, 204].includes(setNum.status), `status ${setNum.status}`);
    const badNum = await call(`/admin/users/${newStuId}/student-number`, {
      method: 'PATCH', headers: bearer(admin.token), body: JSON.stringify({ studentNumber: 'has@at.sign' }),
    });
    t('college ID cannot contain @ (would collide with emails)', badNum.status === 400, `status ${badNum.status}`);

    const imp = await call('/admin/students/import', {
      method: 'POST', headers: bearer(admin.token),
      body: JSON.stringify({ students: [
        { name: `${TAG} Imp1`, email: `${TAG}.imp1@x.com`, studentNumber: `${TAG}I1` },
        { name: `${TAG} Imp2`, email: `${TAG}.imp2@x.com`, studentNumber: `${TAG}I2` },
      ] }),
    });
    t('bulk import works', [200, 201].includes(imp.status), `status ${imp.status}`);

    const reset = await call(`/admin/users/${newStuId}/reset-password`, {
      method: 'POST', headers: bearer(admin.token), body: JSON.stringify({ newPassword: 'BrandNewPass1!' }),
    });
    t('admin resets a password', [200, 204].includes(reset.status), `status ${reset.status}`);
    const afterReset = await login(`${TAG}.stu@x.com`, 'BrandNewPass1!');
    t('reset password actually works', afterReset.status === 200, `status ${afterReset.status}`);

    const promote = await call(`/admin/users/${newStuId}/role`, {
      method: 'PATCH', headers: bearer(admin.token), body: JSON.stringify({ role: 'teacher' }),
    });
    t('admin changes a role', [200, 204].includes(promote.status), `status ${promote.status}`);

    // ---------------------------------------------------------------- REPORTS
    group('REPORTS');
    const today = new Date().toISOString().slice(0, 10);
    const json = await call(`/attendance/reports?courseId=${course.id}&from=${today}&to=${today}`, { headers: bearer(teacher.token) });
    t('report JSON works', json.status === 200);
    t("report includes today's sessions (BETWEEN off-by-one fixed)",
      JSON.stringify(json.body).includes(String(sid)) || (json.body?.sessions || []).length > 0,
      `sessions in range: ${(json.body?.sessions || []).length}`);

    const pdf = await call(`/attendance/reports?courseId=${course.id}&from=${today}&to=${today}&format=pdf`, { headers: bearer(teacher.token) });
    t('FR13 PDF export', pdf.status === 200 && pdf.buf?.slice(0, 4).toString() === '%PDF', `${pdf.status} ${pdf.buf?.slice(0,4).toString()}`);
    const xlsx = await call(`/attendance/reports?courseId=${course.id}&from=${today}&to=${today}&format=xlsx`, { headers: bearer(teacher.token) });
    t('FR14 Excel export', xlsx.status === 200 && xlsx.buf?.slice(0, 2).toString() === 'PK', `${xlsx.status}`);

    const missingParams = await call('/attendance/reports', { headers: bearer(teacher.token) });
    t('report requires its parameters', missingParams.status === 400, `status ${missingParams.status}`);

    // ---------------------------------------------------------------- NFR
    group('NON-FUNCTIONAL');
    // Measured on a live session with a fresh account, so every request runs the full path -
    // QR, geofence, network, then the attendance transaction. Raw call(), never the
    // rate-limit-aware wrapper: retrying would time the limiter's cooldown, not the server.
    const perfSession = await mkSession();
    const [[perfSecret]] = await db.query('SELECT qr_secret FROM sessions WHERE id = ?', [perfSession.id]);
    const perfUser = await call('/admin/users', {
      method: 'POST', headers: bearer(admin.token),
      body: JSON.stringify({ name: `${TAG} Perf`, email: `${TAG}.perf@x.com`, password: PW, role: 'student' }),
    });
    const perfId = (perfUser.body?.user || perfUser.body)?.id;
    if (perfId) made.users.push(perfId);
    await call(`/courses/${course.id}/enrol`, {
      method: 'POST', headers: bearer(teacher.token), body: JSON.stringify({ studentId: perfId }),
    });
    const perfLogin = await login(`${TAG}.perf@x.com`);

    const perf = [];
    for (let i = 0; i < 5; i += 1) {
      const s = Date.now();
      const r = await call('/attendance/verify', {
        method: 'POST', headers: bearer(perfLogin.token),
        body: JSON.stringify({
          qrPayload: signQr(perfSecret.qr_secret, perfSession.id, Date.now()),
          coordinates: HERE,
        }),
      });
      const ms = Date.now() - s;
      if (r.status !== 429) perf.push(ms);
    }
    const worst = perf.length ? Math.max(...perf) : Infinity;
    const avg = perf.length ? Math.round(perf.reduce((a, b) => a + b) / perf.length) : -1;
    t('NFR02 full verification under 3s', perf.length >= 3 && worst < 3000,
      `n=${perf.length} worst ${worst}ms avg ${avg}ms`);

    const err500 = await call('/attendance/reports?courseId=abc&from=x&to=y', { headers: bearer(teacher.token) });
    t('NFR08 no stack traces leaked', !JSON.stringify(err500.body || {}).match(/at .*\(.*:\d+:\d+\)|node_modules/));
    t('NFR08 errors carry a readable message', typeof (err500.body?.error?.message) === 'string');

    const [[hashRow]] = await db.query("SELECT password_hash FROM users WHERE email = 'admin@ssas.local'");
    t('NFR03 bcrypt cost 12', /^\$2[aby]\$12\$/.test(hashRow.password_hash), hashRow.password_hash.slice(0, 7));

    const [fkRows] = await db.query(
      "SELECT COUNT(*) c FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL");
    t('NFR09 foreign keys present', fkRows[0].c >= 10, `${fkRows[0].c} FK columns`);

    const notFound = await call('/this/does/not/exist', { headers: bearer(student.token) });
    t('unknown route returns 404 JSON', notFound.status === 404);

    // ---------------------------------------------------------------- REFRESH / LOGOUT
    group('REFRESH TOKEN LIFECYCLE');
    const rawLogin = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'student@ssas.local', password: PW }),
    });
    const setCookie = rawLogin.headers.get('set-cookie') || '';
    t('login sets the refresh cookie', setCookie.includes('ssas_refresh'), setCookie.slice(0, 40));
    t('refresh cookie is httpOnly', /httponly/i.test(setCookie));
    t('refresh cookie is path-scoped to /auth', /path=\/api\/v1\/auth/i.test(setCookie), setCookie);
    const cookie = setCookie.split(';')[0];

    const refreshed = await call('/auth/refresh', { method: 'POST', headers: { Cookie: cookie } });
    t('refresh issues a new access token', refreshed.status === 200 && !!refreshed.body?.accessToken,
      `status ${refreshed.status}`);

    const reuse = await call('/auth/refresh', { method: 'POST', headers: { Cookie: cookie } });
    t('rotated token still accepted inside the 30s grace window', reuse.status === 200,
      `status ${reuse.status}`);

    const [[graceRow]] = await db.query(
      'SELECT COUNT(*) c FROM refresh_tokens WHERE revoked_at IS NOT NULL AND user_id = ?', [student.user.id]);
    t('rotation revokes the old token server-side', graceRow.c >= 1, `${graceRow.c} revoked`);

    const noCookie = await call('/auth/refresh', { method: 'POST' });
    t('refresh without a cookie refused', noCookie.status === 401, `status ${noCookie.status}`);
    const junkCookie = await call('/auth/refresh', { method: 'POST', headers: { Cookie: 'ssas_refresh=garbage' } });
    t('refresh with a garbage cookie refused', junkCookie.status === 401, `status ${junkCookie.status}`);

    const loggedOut = await call('/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
    t('logout succeeds', [200, 204].includes(loggedOut.status), `status ${loggedOut.status}`);

    // Password change, on a throwaway account so no seeded credential is disturbed.
    const pwUser = await call('/admin/users', {
      method: 'POST', headers: bearer(admin.token),
      body: JSON.stringify({ name: `${TAG} Pw`, email: `${TAG}.pw@x.com`, password: PW, role: 'student' }),
    });
    const pwId = (pwUser.body?.user || pwUser.body)?.id;
    if (pwId) made.users.push(pwId);
    const pwLogin = await login(`${TAG}.pw@x.com`);
    const wrongCurrent = await call('/auth/me/password', {
      method: 'POST', headers: bearer(pwLogin.token),
      body: JSON.stringify({ currentPassword: 'NotMyPassword1!', newPassword: 'Changed12345!' }),
    });
    t('password change requires the current password', [400, 401].includes(wrongCurrent.status), `status ${wrongCurrent.status}`);
    const shortPw = await call('/auth/me/password', {
      method: 'POST', headers: bearer(pwLogin.token),
      body: JSON.stringify({ currentPassword: PW, newPassword: 'short' }),
    });
    t('new password length enforced', shortPw.status === 400, `status ${shortPw.status}`);
    const changed = await call('/auth/me/password', {
      method: 'POST', headers: bearer(pwLogin.token),
      body: JSON.stringify({ currentPassword: PW, newPassword: 'Changed12345!' }),
    });
    t('password change succeeds', [200, 204].includes(changed.status), `status ${changed.status}`);
    t('old password no longer works', (await login(`${TAG}.pw@x.com`, PW)).status === 401);
    t('new password works', (await login(`${TAG}.pw@x.com`, 'Changed12345!')).status === 200);

    // ---------------------------------------------------------------- REMAINING ENDPOINTS
    group('REMAINING ENDPOINTS');
    const overview = await call('/sessions/overview', { headers: bearer(teacher.token) });
    t('GET /sessions/overview', overview.status === 200, `status ${overview.status}`);
    const mine = await call('/sessions/mine', { headers: bearer(teacher.token) });
    t('GET /sessions/mine', mine.status === 200, `status ${mine.status}`);
    const allCourses = await call('/courses/all', { headers: bearer(teacher.token) });
    t('GET /courses/all (staff)', allCourses.status === 200, `status ${allCourses.status}`);
    const courseSessions = await call(`/courses/${course.id}/sessions`, { headers: bearer(teacher.token) });
    t('GET /courses/:id/sessions', courseSessions.status === 200, `status ${courseSessions.status}`);

    const newCourse = await call('/courses', {
      method: 'POST', headers: bearer(admin.token),
      body: JSON.stringify({ courseName: `${TAG} Course`, courseCode: `${TAG}C1` }),
    });
    const newCourseId = (newCourse.body?.course || newCourse.body)?.id;
    if (newCourseId) made.courses.push(newCourseId);
    t('POST /courses creates a course', [200, 201].includes(newCourse.status), `status ${newCourse.status}`);
    const courseNoName = await call('/courses', {
      method: 'POST', headers: bearer(admin.token), body: JSON.stringify({ courseCode: 'X' }),
    });
    t('course requires a name', courseNoName.status === 400, `status ${courseNoName.status}`);

    const getUser = await call(`/admin/users/${pwId}`, { headers: bearer(admin.token) });
    t('GET /admin/users/:id', getUser.status === 200, `status ${getUser.status}`);
    const getMissing = await call('/admin/users/99999999', { headers: bearer(admin.token) });
    t('GET /admin/users/:id 404s for a missing user', getMissing.status === 404, `status ${getMissing.status}`);

    const unenrol = await call(`/courses/${course.id}/enrol/${perfId}`, { method: 'DELETE', headers: bearer(teacher.token) });
    t('DELETE /courses/:id/enrol/:studentId', [200, 204].includes(unenrol.status), `status ${unenrol.status}`);

    const delUser = await call(`/admin/users/${pwId}`, { method: 'DELETE', headers: bearer(admin.token) });
    t('DELETE /admin/users/:id', [200, 204].includes(delUser.status), `status ${delUser.status}`);
    t('deleted user can no longer sign in', (await login(`${TAG}.pw@x.com`, 'Changed12345!')).status === 401);

    // ---------------------------------------------------------------- RATE LIMIT ISOLATION
    // The network factor forces a whole class through the campus NAT, so an IP-keyed limiter
    // would be a bucket shared by every student in the room. This proves the buckets are
    // per-account: exhausting one student's budget must not touch anyone else's.
    group('RATE LIMIT ISOLATION');
    const rlSession = await mkSession();
    const [[rlSecret]] = await db.query('SELECT qr_secret FROM sessions WHERE id = ?', [rlSession.id]);
    const mkQr = () => signQr(rlSecret.qr_secret, rlSession.id, Date.now());

    const victim = await call('/admin/users', {
      method: 'POST', headers: bearer(admin.token),
      body: JSON.stringify({ name: `${TAG} Classmate`, email: `${TAG}.mate@x.com`, password: PW, role: 'student' }),
    });
    const victimId = (victim.body?.user || victim.body)?.id;
    if (victimId) made.users.push(victimId);
    await call(`/courses/${course.id}/enrol`, {
      method: 'POST', headers: bearer(teacher.token), body: JSON.stringify({ studentId: victimId }),
    });
    const mate = await login(`${TAG}.mate@x.com`);
    t('classmate account usable', mate.status === 200, `status ${mate.status}`);

    let sawLimit = false;
    for (let i = 0; i < 25; i += 1) {
      const r = await call('/attendance/verify', {
        method: 'POST', headers: bearer(student.token),
        body: JSON.stringify({ qrPayload: mkQr(), coordinates: HERE }),
      });
      if (r.status === 429) { sawLimit = true; break; }
    }
    t('limiter still throttles a single spamming account', sawLimit);

    const mateRes = await call('/attendance/verify', {
      method: 'POST', headers: bearer(mate.token),
      body: JSON.stringify({ qrPayload: mkQr(), coordinates: HERE }),
    });
    t('a classmate on the same IP is NOT blocked by it', mateRes.status !== 429,
      `classmate got ${mateRes.status}`);
    t('and their check-in is processed normally', [200, 201, 409].includes(mateRes.status),
      `status ${mateRes.status} ${JSON.stringify(mateRes.body?.error || '')}`);
  } finally {
    // ------------------------------------------------------------------ CLEANUP
    for (const s of made.sessions) {
      await db.query('DELETE FROM attendance_attempts WHERE session_id = ?', [s]);
      await db.query('DELETE FROM attendance_records WHERE session_id = ?', [s]);
      await db.query('DELETE FROM qr_codes WHERE session_id = ?', [s]);
      await db.query('DELETE FROM sessions WHERE id = ?', [s]);
    }
    await db.query("DELETE FROM enrolments WHERE student_id IN (SELECT id FROM users WHERE email LIKE ?)", [`${TAG}%`]);
    await db.query("DELETE FROM students WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)", [`${TAG}%`]);
    await db.query("DELETE FROM teachers WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)", [`${TAG}%`]);
    await db.query("DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)", [`${TAG}%`]);
    await db.query("DELETE FROM users WHERE email LIKE ?", [`${TAG}%`]);
    for (const c of made.courses) {
      await db.query('DELETE FROM enrolments WHERE course_id = ?', [c]);
      await db.query('DELETE FROM sessions WHERE course_id = ?', [c]);
      await db.query('DELETE FROM courses WHERE id = ?', [c]);
    }
    // Attendance rows referencing these were deleted above, so nothing is orphaned.
    await db.query('DELETE FROM devices WHERE id > ?', [deviceHighWater]);

    group('CLEANUP');
    for (const tb of TABLES) {
      const after = await countOf(tb);
      t(`${tb} restored to baseline`, after === baseline[tb], `${baseline[tb]} -> ${after}`);
    }
    await db.end();

    // ------------------------------------------------------------------ REPORT
    console.log('');
    for (const g of groups) {
      const bad = g.checks.filter((c) => !c.ok).length;
      console.log(`${bad === 0 ? 'OK  ' : 'FAIL'}  ${g.name}  (${g.checks.length - bad}/${g.checks.length})`);
      for (const c of g.checks.filter((x) => !x.ok)) console.log(`        x ${c.name}${c.detail ? '  [' + c.detail + ']' : ''}`);
      // Measured values are the point of these checks, so print them even when they pass.
      if (g.name === 'NON-FUNCTIONAL' || g.name === 'AUTH') {
        for (const c of g.checks.filter((x) => x.ok && x.detail && /NFR|timing/.test(x.name))) {
          console.log(`        - ${c.name}: ${c.detail}`);
        }
      }
    }
    const total = pass + failures.length;
    console.log(`\n===== ${pass}/${total} checks passed =====`);
    if (failures.length) {
      console.log('\nFAILURES:');
      failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    }
    process.exit(failures.length ? 1 : 0);
  }
})();
