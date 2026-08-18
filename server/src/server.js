const app = require('./app');
const env = require('./config/env');
const pool = require('./config/db');
const { migrate } = require('./db/migrate');
const { bootstrapIfEmpty } = require('./db/bootstrap');
const { startBackgroundMaintenance } = require('./services/maintenance.service');
const { startScheduledBackups } = require('./services/backup.service');

const DB_WAIT_TIMEOUT_MS = Number(process.env.DB_WAIT_TIMEOUT_MS || 60000);

// A deployment platform starts this container as soon as its image is ready, which can be
// before the database accepts connections - a managed MySQL restarts itself part-way through
// first-time initialisation, so even "the port is open" is not proof it is ready. Exiting on
// the first refused connection turns an ordinary few-second startup ordering into a failed
// deploy. Bounded, so a genuinely unreachable database still fails instead of hanging forever.
async function waitForDatabase() {
  const deadline = Date.now() + DB_WAIT_TIMEOUT_MS;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      if (attempt > 1) console.log(`[db] reachable after ${attempt} attempts`);
      return;
    } catch (err) {
      if (Date.now() >= deadline) {
        throw new Error(
          `database unreachable after ${Math.round(DB_WAIT_TIMEOUT_MS / 1000)}s (${attempt} attempts): ${err.message}`
        );
      }
      if (attempt === 1) console.log(`[db] not ready yet (${err.code || err.message}), waiting...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Applied before the port opens, so a deployment can never serve traffic against a schema the
// code does not expect. Forward-only and checksummed, so re-running is a no-op - unlike
// db:init, which is a factory reset and must never run automatically.
const runMigrationsOnStart =
  String(process.env.RUN_MIGRATIONS_ON_START || String(env.isProduction)).toLowerCase() === 'true';

async function start() {
  if (runMigrationsOnStart) {
    try {
      await waitForDatabase();
      // Only acts on a database with no tables at all; a no-op on every subsequent deploy.
      await bootstrapIfEmpty();
      const applied = await migrate();
      const n = Array.isArray(applied) ? applied.length : 0;
      console.log(n ? `[migrate] applied ${n} migration(s)` : '[migrate] schema already up to date');
    } catch (err) {
      // A half-migrated schema serving requests corrupts data quietly; refusing to start is
      // loud and recoverable. Covers both the wait and the migration itself, so the message
      // stays accurate whichever failed.
      console.error('[startup] FAILED, refusing to start:', err.message);
      process.exit(1);
    }
  }

  app.listen(env.port, () => {
    console.log(`SSAS API listening on port ${env.port} (${env.nodeEnv})`);
    if (env.serveClient) console.log('[client] serving built SPA from client/dist');
    startBackgroundMaintenance();
    // NFR10: daily automated backup, plus one on boot so a new deployment has a restore point
    // straight away rather than after the first 24 hours.
    if (env.backupsEnabled) startScheduledBackups();
  });
}

// Without these, a rejected promise or a thrown callback leaves the process running in an
// unknown state - which on a platform that only restarts on exit means it never recovers.
process.on('unhandledRejection', (err) => {
  console.error('[fatal] unhandled rejection:', err);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception:', err);
  process.exit(1);
});

start();
