/**
 * Provision an administrator from the command line.
 *
 *   npm run admin:create -- --email you@college.edu --name "Your Name" --password "..."
 *
 * Every in-app route that can mint an admin requires an existing admin, which is correct -
 * an attendance system where anyone can self-register as an administrator has no integrity
 * to protect. But that leaves the bootstrap: the FIRST admin cannot come from inside the
 * application, and `db:init` seeds one whose password is published in the README. Shipping a
 * real deployment with that account live is the most likely way this system gets taken over.
 *
 * This is the deliberate out-of-band path: it requires shell access to the server, which is
 * a privilege level above any application role, so it grants nothing an attacker could not
 * already do.
 */
const readline = require('readline');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const env = require('../config/env');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const m = argv[i].match(/^--([a-z-]+)$/);
    if (m) out[m[1]] = argv[i + 1];
  }
  return out;
}

// Hidden prompt so a password typed at the terminal does not end up in shell history or on
// a shoulder-surfer's screen.
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) {
        process.stdin.removeListener('data', onData);
      } else {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + '*'.repeat(rl.line.length));
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name || process.env.ADMIN_NAME;
  const email = (args.email || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  let password = args.password || process.env.ADMIN_PASSWORD;

  if (!name || !email) {
    throw new Error(
      'Usage: npm run admin:create -- --email you@college.edu --name "Your Name" [--password "..."]\n' +
        'Omit --password to be prompted for it without it appearing in your shell history.'
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`"${email}" is not a valid email address`);
  }

  if (!password) password = await promptHidden('New admin password: ');
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const [existing] = await pool.query('SELECT id, role FROM users WHERE email = ?', [email]);
  if (existing.length > 0) {
    throw new Error(
      `An account already exists for ${email} (role: ${existing[0].role}). ` +
        'Change its role from Admin -> Users, or use a different address.'
    );
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, 'admin']
  );

  const [[{ admins }]] = await pool.query(
    "SELECT COUNT(*) AS admins FROM users WHERE role = 'admin'"
  );

  console.log(`\nAdministrator created: ${name} <${email}> (id ${result.insertId})`);
  console.log(`There are now ${admins} administrator account(s).`);
  console.log('\nIf the seeded demo admin (admin@ssas.local) is still live with the password');
  console.log('published in the README, remove it or change its password now:');
  console.log('  Admin -> Users -> Reset, or Remove.\n');
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(`\n${err.message}\n`);
    await pool.end();
    process.exitCode = 1;
  });
