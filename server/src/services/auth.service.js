const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../utils/jwt');

const BCRYPT_ROUNDS = 12;

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
async function login({ email, password }) {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];

  if (!user) {
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

  if (!stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
    throw new ApiError(401, 'Refresh token is no longer valid');
  }

  const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
  const user = userRows[0];
  if (!user) {
    throw new ApiError(401, 'Account no longer exists');
  }

  // Rotate: revoke the used refresh token and issue a fresh pair.
  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?', [stored.id]);
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

module.exports = { register, login, refresh, logout, getProfile };
