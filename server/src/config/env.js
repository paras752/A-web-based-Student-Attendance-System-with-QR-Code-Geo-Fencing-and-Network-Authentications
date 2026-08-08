require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT || 5000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ssas',
  },

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // One definition, because it was previously repeated in three places and the seed script's
  // copy had drifted to 10 - so the demo accounts a grader actually logs in with were weaker
  // than the 12 rounds the report claims, while every runtime-created account used 12.
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),

  qrValidityWindowSeconds: Number(process.env.QR_VALIDITY_WINDOW_SECONDS || 30),
  defaultGeofenceRadiusM: Number(process.env.DEFAULT_GEOFENCE_RADIUS_M || 50),

  // The attendance floor most institutions require to sit an exam. A bare percentage tells a
  // student nothing on its own - it is only actionable against the number they have to reach.
  minimumAttendancePercent: Number(process.env.MINIMUM_ATTENDANCE_PERCENT || 75),

  // Off by default: in the real deployment the college issues every student account, so the
  // public sign-up form would only ever create accounts that correspond to nobody on any
  // roster. Set ALLOW_PUBLIC_REGISTRATION=true to reopen it (useful for a standalone demo).
  allowPublicRegistration: String(process.env.ALLOW_PUBLIC_REGISTRATION || 'false').toLowerCase() === 'true',

  // NFR10. On by default because an attendance system that silently stops backing up is
  // exactly the failure the requirement exists to prevent; set false to opt out.
  backupsEnabled: String(process.env.BACKUPS_ENABLED || 'true').toLowerCase() === 'true',

  // Institution-wide subnet used by the public /auth/status probe so the login screen can
  // report whether the visitor is already on campus Wi-Fi. Per-session checks still use the
  // subnet the teacher set on that session; this is only an at-a-glance indicator.
  // "any" (the dev default) means every network is treated as campus.
  campusSubnet: process.env.CAMPUS_SUBNET || 'any',
};
