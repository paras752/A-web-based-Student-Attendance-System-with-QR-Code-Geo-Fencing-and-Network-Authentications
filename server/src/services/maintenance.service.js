const pool = require('../config/db');

// refresh_tokens grows on every login AND every rotation - a single user with the app open
// all day adds a row every 15 minutes - and nothing ever removed them. Left alone it becomes
// the largest table in the database, made entirely of rows that can no longer authenticate
// anything.
//
// Dead rows are kept for a grace period rather than deleted the moment they expire: if a
// student reports "it logged me out", the recent history of issue/rotate/revoke is the only
// evidence of what happened.
const RETENTION_DAYS = Number(process.env.REFRESH_TOKEN_RETENTION_DAYS || 7);
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Attempt logs are diagnostic, and their value decays fast: "why could nobody check in on
// Tuesday" is asked within days, not years. Kept much longer than refresh tokens because a
// disputed absence can surface at the end of term, but not forever - this table gets a row
// per attempt, including every retry a frustrated student makes.
const ATTEMPT_RETENTION_DAYS = Number(process.env.ATTENDANCE_ATTEMPT_RETENTION_DAYS || 180);

async function purgeStaleRefreshTokens({ retentionDays = RETENTION_DAYS } = {}) {
  const [result] = await pool.query(
    `DELETE FROM refresh_tokens
      WHERE (expires_at < NOW() - INTERVAL ? DAY)
         OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL ? DAY)`,
    [retentionDays, retentionDays]
  );
  return result.affectedRows;
}

async function purgeOldAttendanceAttempts({ retentionDays = ATTEMPT_RETENTION_DAYS } = {}) {
  const [result] = await pool.query(
    'DELETE FROM attendance_attempts WHERE attempted_at < NOW() - INTERVAL ? DAY',
    [retentionDays]
  );
  return result.affectedRows;
}

// Runs on boot and then every few hours. unref() so a pending timer never holds the process
// open - without it the API would refuse to exit cleanly on Ctrl-C.
function startBackgroundMaintenance() {
  const run = async () => {
    try {
      const tokens = await purgeStaleRefreshTokens();
      if (tokens > 0) console.log(`[maintenance] purged ${tokens} stale refresh token(s)`);
    } catch (err) {
      console.error('[maintenance] refresh token purge failed:', err.message);
    }
    try {
      const attempts = await purgeOldAttendanceAttempts();
      if (attempts > 0) console.log(`[maintenance] purged ${attempts} old attendance attempt(s)`);
    } catch (err) {
      console.error('[maintenance] attendance attempt purge failed:', err.message);
    }
  };

  run();
  const timer = setInterval(run, PURGE_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = {
  purgeStaleRefreshTokens,
  purgeOldAttendanceAttempts,
  startBackgroundMaintenance,
  RETENTION_DAYS,
  ATTEMPT_RETENTION_DAYS,
};
