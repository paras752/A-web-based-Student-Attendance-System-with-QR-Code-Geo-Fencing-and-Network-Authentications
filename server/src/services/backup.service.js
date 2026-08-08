const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const env = require('../config/env');

const execFileAsync = promisify(execFile);

// NFR10 ("The system must automatically back up attendance records", target: daily backup)
// and the proposal's in-scope "Automated database back-up and recovery system".
//
// mysqldump rather than an application-level export on purpose: it captures schema, data,
// constraints and the schema_migrations ledger in one restorable artefact. An export written
// by this app could only ever contain what this app remembered to include, and a backup you
// cannot restore is not a backup.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const INTERVAL_MS = 24 * 60 * 60 * 1000;

// Common install locations, tried in order. Configurable because a Windows/XAMPP box and a
// Linux server keep it in entirely different places.
const CANDIDATE_DUMP_PATHS = [
  process.env.MYSQLDUMP_PATH,
  'C:/xampp/mysql/bin/mysqldump.exe',
  'mysqldump',
].filter(Boolean);

async function resolveMysqldump() {
  for (const candidate of CANDIDATE_DUMP_PATHS) {
    try {
      await execFileAsync(candidate, ['--version']);
      return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function runBackup() {
  const dump = await resolveMysqldump();
  if (!dump) {
    throw new Error(
      'mysqldump not found. Set MYSQLDUMP_PATH to its full path to enable automated backups.'
    );
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `${env.db.database}-${timestamp()}.sql`);

  const args = [
    '-h', env.db.host,
    '-P', String(env.db.port),
    '-u', env.db.user,
    // --single-transaction takes a consistent snapshot without locking the tables, so a
    // backup running mid-class cannot block a student checking in.
    '--single-transaction',
    '--routines',
    '--databases', env.db.database,
    `--result-file=${file}`,
  ];
  // Passed as one argument because mysqldump takes no space after -p. Never interpolated
  // into a shell string - execFile does not spawn a shell, so the password cannot leak
  // through shell history or be mangled by quoting.
  if (env.db.password) args.splice(6, 0, `-p${env.db.password}`);

  await execFileAsync(dump, args, { maxBuffer: 64 * 1024 * 1024 });

  const { size } = fs.statSync(file);
  if (size === 0) {
    fs.unlinkSync(file);
    throw new Error('mysqldump produced an empty file; backup discarded');
  }

  return { file, bytes: size };
}

// Old dumps are removed on a schedule of their own: a backup directory that grows without
// limit eventually fills the disk and takes the database down with it.
function pruneOldBackups({ retentionDays = RETENTION_DAYS } = {}) {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!name.endsWith('.sql')) continue;
    const full = path.join(BACKUP_DIR, name);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      removed += 1;
    }
  }
  return removed;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((n) => n.endsWith('.sql'))
    .map((n) => {
      const s = fs.statSync(path.join(BACKUP_DIR, n));
      return { name: n, bytes: s.size, takenAt: s.mtime };
    })
    .sort((a, b) => b.takenAt - a.takenAt);
}

// Daily, and once on boot so a fresh deployment has a restore point immediately rather than
// 24 hours later. unref() so the timer never holds the process open.
function startScheduledBackups() {
  const run = () =>
    runBackup()
      .then(({ file, bytes }) => {
        console.log(`[backup] wrote ${path.basename(file)} (${Math.round(bytes / 1024)} KB)`);
        const pruned = pruneOldBackups();
        if (pruned > 0) console.log(`[backup] pruned ${pruned} backup(s) past retention`);
      })
      .catch((err) => console.error('[backup] failed:', err.message));

  run();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { runBackup, pruneOldBackups, listBackups, startScheduledBackups, BACKUP_DIR };
