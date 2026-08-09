const app = require('./app');
const env = require('./config/env');
const { migrate } = require('./db/migrate');
const { startBackgroundMaintenance } = require('./services/maintenance.service');
const { startScheduledBackups } = require('./services/backup.service');

// Applied before the port opens, so a deployment can never serve traffic against a schema the
// code does not expect. Forward-only and checksummed, so re-running is a no-op - unlike
// db:init, which is a factory reset and must never run automatically.
const runMigrationsOnStart =
  String(process.env.RUN_MIGRATIONS_ON_START || String(env.isProduction)).toLowerCase() === 'true';

async function start() {
  if (runMigrationsOnStart) {
    try {
      const applied = await migrate();
      const n = Array.isArray(applied) ? applied.length : 0;
      console.log(n ? `[migrate] applied ${n} migration(s)` : '[migrate] schema already up to date');
    } catch (err) {
      // A half-migrated schema serving requests corrupts data quietly; refusing to start is
      // loud and recoverable.
      console.error('[migrate] FAILED, refusing to start:', err.message);
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
