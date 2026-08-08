const bcrypt = require('bcrypt');
const pool = require('../config/db');
const env = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../utils/jwt');

const BCRYPT_ROUNDS = env.bcryptRounds;

// How long a just-rotated refresh token stays acceptable, to absorb races between a page
// unloading and the next one booting. Short enough that a replayed stolen token is still
// caught; long enough that an ordinary navigation never signs anyone out.
const REFRESH_ROTATION_GRACE_MS = Number(process.env.REFRESH_ROTATION_GRACE_MS || 30_000);

// A real bcrypt hash of a value nothing can match, used to spend the same ~100ms on an
// unknown identifier as on a known one. Generated once at load rather than per request.
const DUMMY_HASH = bcrypt.hashSync('unmatchable-placeholder-for-timing-parity', BCRYPT_ROUNDS);

async function register({ name, email, password, role, profile }) {
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [userResult] = await connection.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, passwordHash, role]
    );
    const userId = userResult.insertId;

    if (role === 'student') {
      await connection.query(
        'INSERT INTO students (user_id, student_number, program, semester, section) VALUES (?, ?, ?, ?, ?)',
        [
          userId,
          profile?.studentNumber || `S${userId}`,
          profile?.program || null,
          profile?.semester || null,
          profile?.section || null,
        ]
      );
    } else if (role === 'teacher') {
      await connection.query(
        'INSERT INTO teachers (user_id, department, designation) VALUES (?, ?, ?)',
        [userId, profile?.department || null, profile?.designation || null]
      );
    }

    await connection.commit();
    return { id: userId, name, email, role };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// Mirrors pseudocode 4.9.1 exactly: identical "Invalid credentials" response whether the
// account doesn't exist or the password is wrong, so the login endpoint can't be used to
// enumerate valid accounts.
//
// The identifier is an email OR a student number. Students are issued a college ID and are
// far more likely to remember it than whichever address they were registered under, and
// staff have no student number, so the two namespaces cannot collide.
async function login({ identifier, password }) {
  const [rows] = await pool.query(
    `SELECT u.* FROM users u
      LEFT JOIN students s ON s.user_id = u.id
     WHERE u.email = ? OR s.student_number = ?
     LIMIT 1`,
    [identifier, identifier]
  );
  const user = rows[0];

  if (!user) {
    // Still run a hash comparison for an unknown identifier. Returning immediately makes a
    // miss measurably faster than a wrong password, which turns response time into an
    // account-enumeration oracle and undoes the identical error message above.
    await bcrypt.compare(password, DUMMY_HASH);
    throw new ApiError(401, 'Invalid credentials');
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new ApiError(401, 'Invalid credentials');
  }

  return issueTokenPair(user);
}

async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  const decoded = verifyRefreshToken(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);

  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, hashToken(refreshToken), expiresAt]
  );

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

// Refresh tokens are stored server-side specifically so they can be revoked here; a stolen
// but already-revoked/expired refresh token cannot mint new access tokens (Section 2.6).
async function refresh({ refreshToken }) {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const tokenHash = hashToken(refreshToken);
  const [rows] = await pool.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = ? AND user_id = ?',
    [tokenHash, decoded.userId]
  );
  const stored = rows[0];

  if (!stored || new Date(stored.expires_at) < new Date()) {
    throw new ApiError(401, 'Refresh token is no longer valid');
  }

  // Rotation races are normal, not attacks. The client de-duplicates concurrent refreshes
  // within one page, but it cannot across a navigation: the live-session screen polls every
  // few seconds, so a poll's 401-retry can rotate the cookie at the same moment the next
  // page boots and presents the value it read a fraction earlier. The loser then arrives
  // holding a token revoked milliseconds ago and - before this window existed - was logged
  // out mid-lesson for doing nothing wrong.
  //
  // A token replayed LONG after rotation is still refused: that is the case worth treating
  // as theft, and it is unaffected by a few seconds of tolerance here.
  if (stored.revoked_at) {
    const revokedMsAgo = Date.now() - new Date(stored.revoked_at).getTime();
    if (revokedMsAgo > REFRESH_ROTATION_GRACE_MS) {
      throw new ApiError(401, 'Refresh token is no longer valid');
    }
  }

  const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
  const user = userRows[0];
  if (!user) {
    throw new ApiError(401, 'Account no longer exists');
  }

  // Rotate: revoke the used refresh token and issue a fresh pair. Guarded on revoked_at
  // being NULL so a replay inside the grace window does not keep pushing the revocation
  // timestamp forward and quietly extend its own validity indefinitely.
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL',
    [stored.id]
  );
  return issueTokenPair(user);
}

async function logout({ refreshToken }) {
  if (!refreshToken) return;
  const tokenHash = hashToken(refreshToken);
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL',
    [tokenHash]
  );
}

async function getProfile(userId) {
  const [rows] = await pool.query(
    'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
    [userId]
  );
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found');

  if (user.role === 'student') {
    const [[student]] = await pool.query(
      'SELECT student_number, program, semester, section FROM students WHERE user_id = ?',
      [userId]
    );
    return { ...user, profile: student || null };
  }
  if (user.role === 'teacher') {
    const [[teacher]] = await pool.query(
      'SELECT department, designation FROM teachers WHERE user_id = ?',
      [userId]
    );
    return { ...user, profile: teacher || null };
  }
  return user;
}

// Administrative edit of a user's record. This is NOT self-service: everything it touches is
// an institutional fact rather than a personal preference.
//
// Name is the one that looks harmless and isn't. Teacher rosters and attendance reports
// identify students by name alongside their student number; the number is locked, so if the
// name were self-editable a student could make their row in a live roster read as somebody
// else. Programme, semester and section are academic-standing claims the college makes about
// a student, not claims the student makes about themselves. Email is a login identifier.
//
// student_number is still not settable here - it has its own endpoint (setStudentNumber) so
// that changing the identifier every attendance record is keyed to is always a deliberate,
// separate act rather than a side effect of fixing a typo in someone's name.
async function updateUserRecord(userId, { name, email, profile }) {
  const [rows] = await pool.query('SELECT id, role FROM users WHERE id = ?', [userId]);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found');

  if (email) {
    const [clash] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ?', [
      email,
      userId,
    ]);
    if (clash.length > 0) {
      throw new ApiError(409, 'That email is already used by another account');
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const fields = [];
    const values = [];
    if (name) {
      fields.push('name = ?');
      values.push(name);
    }
    if (email) {
      fields.push('email = ?');
      values.push(email);
    }
    if (fields.length > 0) {
      values.push(userId);
      await connection.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    if (user.role === 'student' && profile) {
      await connection.query(
        `UPDATE students SET program = ?, semester = ?, section = ? WHERE user_id = ?`,
        [profile.program ?? null, profile.semester ?? null, profile.section ?? null, userId]
      );
    } else if (user.role === 'teacher' && profile) {
      await connection.query(
        `UPDATE teachers SET department = ?, designation = ? WHERE user_id = ?`,
        [profile.department ?? null, profile.designation ?? null, userId]
      );
    }

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return getProfile(userId);
}

// Requires the current password even though the caller is already authenticated: an access
// token left behind on a shared machine should not be enough to lock the real owner out.
async function changePassword(userId, { currentPassword, newPassword }) {
  const [rows] = await pool.query('SELECT id, password_hash FROM users WHERE id = ?', [userId]);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found');

  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) {
    throw new ApiError(401, 'Your current password is incorrect');
  }
  if (currentPassword === newPassword) {
    throw new ApiError(400, 'The new password must be different from the current one');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

  // Any session opened with the old password is now suspect, so drop every outstanding
  // refresh token; the caller keeps working until its short-lived access token expires.
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  getProfile,
  updateUserRecord,
  changePassword,
};
