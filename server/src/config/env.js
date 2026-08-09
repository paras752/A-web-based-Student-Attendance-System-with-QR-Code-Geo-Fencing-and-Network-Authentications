require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

const DEV_ACCESS_SECRET = 'dev-access-secret-change-me';
const DEV_REFRESH_SECRET = 'dev-refresh-secret-change-me';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Refuses to boot a production deployment on the development defaults. These are published in
// the repository, so a deployment that kept them would let anyone mint a valid admin token -
// no password required, because forging a JWT only needs the signing secret. Failing loudly at
// startup is the only safe behaviour: the alternative is a server that looks healthy and is
// wide open.
function assertProductionSecrets(cfg) {
  if (!IS_PRODUCTION) return;
  const problems = [];
  if (cfg.jwt.accessSecret === DEV_ACCESS_SECRET) problems.push('JWT_ACCESS_SECRET is still the development default');
  if (cfg.jwt.refreshSecret === DEV_REFRESH_SECRET) problems.push('JWT_REFRESH_SECRET is still the development default');
  if (cfg.jwt.accessSecret.length < 32) problems.push('JWT_ACCESS_SECRET must be at least 32 characters');
  if (cfg.jwt.refreshSecret.length < 32) problems.push('JWT_REFRESH_SECRET must be at least 32 characters');
  if (cfg.jwt.accessSecret === cfg.jwt.refreshSecret) problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  // An empty password is normal for a loopback development server and indefensible for a
  // database reachable over a network.
  const dbIsLocal = ['127.0.0.1', 'localhost', '::1'].includes(String(cfg.db.host));
  if (!cfg.db.password && !dbIsLocal) {
    problems.push(`DB_PASSWORD is empty for a remote database host (${cfg.db.host})`);
  }
  // Not "must be non-zero" - a server exposed directly, with no proxy in front, correctly uses
  // 0. What must not happen is nobody deciding: req.ip is what the network factor matches
  // against the authorised subnet and what the rate limiter buckets on. Too low and every
  // student appears to arrive from the platform's load balancer; too high and a client can
  // spoof its own address with X-Forwarded-For. So the value has to be stated explicitly.
  if (process.env.TRUST_PROXY_HOPS === undefined) {
    problems.push(
      'TRUST_PROXY_HOPS is not set. It decides which address the network factor and the rate ' +
      'limiter see, so it must be stated explicitly: 1 behind a single load balancer ' +
      '(Railway/Render), 0 if this server is exposed directly.'
    );
  }
  if (problems.length) {
    throw new Error(
      'Refusing to start in production with an unsafe configuration:\n  - ' + problems.join('\n  - ')
    );
  }
}

const config = {
  nodeEnv: NODE_ENV,
  isProduction: IS_PRODUCTION,
  port: Number(process.env.PORT || 5000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  // Number of reverse proxies in front of this app. Kept as a count rather than `true`:
  // trusting X-Forwarded-For from anyone would let a client spoof req.ip, defeating both the
  // rate limiter and the network-authentication subnet check.
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 0),

  // Serve the built client from the API process. One service is simpler to deploy, and it
  // makes the SPA same-origin with the API, so the refresh cookie needs no cross-site handling.
  serveClient: String(process.env.SERVE_CLIENT || String(IS_PRODUCTION)).toLowerCase() === 'true',

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ssas',
    // Managed MySQL (Railway, Aiven, TiDB) requires TLS. Left off by default so a stock
    // XAMPP install, which has no certificate, still connects.
    ssl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true'
      ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true' }
      : undefined,
  },

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', DEV_ACCESS_SECRET),
    refreshSecret: required('JWT_REFRESH_SECRET', DEV_REFRESH_SECRET),
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

assertProductionSecrets(config);

module.exports = config;
