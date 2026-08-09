# Deploying SSAS to a real server

This describes deploying to **Railway**, which is used because it offers **MySQL** as a managed
service. That matters: this application uses MySQL-specific SQL throughout, so a platform whose
free database is PostgreSQL (Render's, for example) would require rewriting the data layer.

The same `Dockerfile` works on any host that runs containers — Fly.io, Render, a VPS — so
nothing here locks you to Railway. Only the click-paths differ.

> **On cost.** Railway's free allowance is a one-time trial credit rather than a permanent free
> tier, and their pricing changes; check the current plan page before relying on it. If you need
> a genuinely free setup, see [Free alternatives](#free-alternatives) at the end.

---

## What changes when it leaves localhost

Three things about *this* system behave differently in production. Read these before starting.

### 1. The network factor stops matching internal subnets

The third verification factor compares the request's source IP against the session's
`authorised_subnet`. On campus with the server on the same LAN, that is an internal range such
as `192.168.1.0/24`.

**Once the server is on the internet, students no longer arrive from an internal address.** Their
traffic leaves the campus through NAT, so the server sees the college's **public egress IP**. An
internal range can never match it, and every check-in fails with `NETWORK_UNAUTHORISED`.

You must set the authorised subnet to the campus's public address. [How to find it](#7-configure-the-network-factor).

### 2. HTTPS is mandatory, not a nicety

The QR scanner (`getUserMedia`) and geolocation both require a **secure context**. Over plain
`http://`, the camera silently refuses to start and the student page cannot function at all.
Railway terminates HTTPS for you, so this is handled — but never expose the app over bare HTTP.

### 3. `TRUST_PROXY_HOPS` decides which IP the system sees

Behind a load balancer, the direct peer address is the *proxy*, not the student. `req.ip` is what
the network factor matches and what the rate limiter buckets on, so this must be right:

- **Too low** — every student appears to come from the platform's proxy. The network factor
  compares the wrong address, and one student hitting the rate limit throttles everyone.
- **Too high** — the app trusts an `X-Forwarded-For` header the client can set, so anyone can
  spoof their own source address and defeat the network factor outright.

On Railway there is exactly one proxy in front: **`TRUST_PROXY_HOPS=1`**.

The app refuses to start in production unless this is set explicitly. That is deliberate — there
is no safe default, so the choice has to be made rather than inherited.

---

## Architecture in production

One container. Express serves the API *and* the built React SPA from the same origin:

```
                    HTTPS (Railway edge)
                             │
                  ┌──────────▼───────────┐
                  │  ssas web service    │
                  │  Express :5000       │
                  │   /api/v1/*  → API   │
                  │   /*         → SPA   │
                  └──────────┬───────────┘
                             │ TLS
                  ┌──────────▼───────────┐
                  │  Railway MySQL       │
                  └──────────────────────┘
```

Same-origin means the refresh cookie is a first-party cookie, avoiding the cross-site cookie
restrictions browsers increasingly apply.

---

## Before you start

- The GitHub repository, already pushed (`paras752/A-web-based-Student-Attendance-System-...`)
- A Railway account — sign in with GitHub
- MySQL client tools locally (`mysql`, `mysqldump`) — XAMPP already provides these at
  `C:\xampp\mysql\bin`

---

## 1. Create the project and database

1. Railway → **New Project** → **Deploy from GitHub repo** → pick this repository.
2. In the project, **New** → **Database** → **Add MySQL**.
3. Open the MySQL service → **Variables** / **Connect** tab. Note these — you need them twice:
   `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`.

The internal host (`mysql.railway.internal`) only resolves from inside Railway. For the
bootstrap step below you need the **public** host and port from the Connect tab.

## 2. Bootstrap the schema — once

Railway's MySQL starts empty. Migrations are forward-only ALTERs and assume the tables already
exist, so a brand-new database needs the schema created first.

Run this **from your machine**, pointed at the Railway database:

```bash
cd server

# Use the PUBLIC host/port from Railway's Connect tab
DB_HOST=<public-host> \
DB_PORT=<public-port> \
DB_USER=root \
DB_PASSWORD=<password> \
DB_NAME=railway \
DB_SSL=true \
npm run db:init -- --no-seed
```

`--no-seed` is important. Without it, `db:init` creates three demo accounts sharing the password
printed in the README — including an administrator. On a public URL that is three working
logins for anyone who reads the repository.

Expected output:

```
Running schema.sql against 'railway' ...
Schema created, no demo accounts seeded (--no-seed).
```

## 3. Create the first administrator

Every in-app route that can create an admin requires an existing admin, so the first one comes
from the command line:

```bash
cd server

DB_HOST=<public-host> DB_PORT=<public-port> DB_USER=root \
DB_PASSWORD=<password> DB_NAME=railway DB_SSL=true \
npm run admin:create -- --email you@college.edu --name "Paras Thapa"
```

It prompts for the password rather than taking it as an argument, so it stays out of your shell
history. Use a real password — this account administers the live system.

## 4. Generate signing secrets

Two different values, 32+ characters each:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # access
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # refresh
```

These sign the JWTs. Anyone holding the access secret can mint a valid administrator token
without a password, so they must not be reused, shared, or committed. The app refuses to start
in production if they are missing, too short, identical, or left at the development defaults.

## 5. Set the environment variables

On the **web service** (not the database) → **Variables** → paste:

```
NODE_ENV=production
TRUST_PROXY_HOPS=1

JWT_ACCESS_SECRET=<the first generated value>
JWT_REFRESH_SECRET=<the second generated value>

DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
DB_SSL=true

RUN_MIGRATIONS_ON_START=true
ALLOW_PUBLIC_REGISTRATION=false
BACKUPS_ENABLED=false
CAMPUS_SUBNET=any
```

The `${{MySQL.*}}` form is Railway's reference syntax — it wires the database service's values in
automatically, so a rotated password does not silently break the app. If your MySQL service has a
different name, change the prefix to match.

`BACKUPS_ENABLED=false` because the container filesystem is ephemeral: without a mounted volume
the dumps vanish on every redeploy, which is worse than not taking them, since it looks like
NFR10 is satisfied when nothing durable exists. Either rely on Railway's own database backups, or
attach a volume and set `BACKUP_DIR` to its mount path.

The full annotated list is in [`server/.env.production.example`](../server/.env.production.example).

## 6. Deploy and get a URL

Railway builds from the `Dockerfile` automatically (`railway.json` selects it and sets the health
check to `/api/v1/health`).

Then **Settings** → **Networking** → **Generate Domain**. You get
`https://<something>.up.railway.app`.

Check it is alive:

```bash
curl https://<your-app>.up.railway.app/api/v1/health
# {"status":"ok","env":"production","uptimeSeconds":12}
```

Migrations run before the port opens, so a healthy response also means the schema is current.

## 7. Configure the network factor

**Do this on campus, on the college Wi-Fi**, from a phone or laptop:

```
https://<your-app>.up.railway.app/api/v1/auth/status
```

```json
{ "onCampusNetwork": true, "clientIp": "203.0.113.45", "enforced": false, ... }
```

`clientIp` is the address the server actually sees — your campus's public egress IP. If it shows
a `10.x`/`192.168.x` address, `TRUST_PROXY_HOPS` is wrong.

Then set on the web service:

```
CAMPUS_SUBNET=203.0.113.45/32
```

Use `/32` for a single address. Larger colleges egress through a pool — ask IT for the block and
use its real CIDR (e.g. `203.0.113.0/24`). Getting this wrong in the permissive direction is the
worst outcome: too broad a range silently weakens the factor to nothing.

Set the same value as **Authorised subnet** when a teacher creates a session. `CAMPUS_SUBNET` only
drives the login screen's indicator; the per-session value is what actually gates check-in.

Verify from off-campus (mobile data): a check-in must fail with `NETWORK_UNAUTHORISED`.

---

## Post-deployment checklist

- [ ] `/api/v1/health` returns `{"status":"ok","env":"production"}`
- [ ] The site loads over **https://** and the student page can open the camera
- [ ] `/api/v1/auth/status` on campus shows the public egress IP, not `10.x`/`192.168.x`
- [ ] Log in as the admin created in step 3
- [ ] `admin@ssas.local` does **not** exist (it never should, with `--no-seed`)
- [ ] Sign-up is closed — `allowPublicRegistration` is `false` in `/api/v1/auth/status`
- [ ] A full three-factor check-in succeeds on campus
- [ ] The same check-in fails off-campus with `NETWORK_UNAUTHORISED`
- [ ] A student who already checked in gets `409 DUPLICATE_SUBMISSION`

Run the full suite against the deployed instance:

```bash
cd server
SUITE_API=https://<your-app>.up.railway.app/api/v1 npm run test:system
```

> The suite connects **directly to the database** as well as over HTTP, so point `DB_*` at the
> Railway public host when running it against a deployment. It creates and deletes its own data
> and re-asserts every table's row count, but it is still a live database — prefer running it
> before real attendance exists.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Deploy crashes: *"Refusing to start in production with an unsafe configuration"* | Read the list it prints — a missing/weak/duplicate JWT secret, or `TRUST_PROXY_HOPS` unset. It is doing its job. |
| Every check-in fails `NETWORK_UNAUTHORISED` | `authorised_subnet` is an internal range. Use the public egress IP (step 7). |
| `/auth/status` shows a `10.x` address as `clientIp` | `TRUST_PROXY_HOPS` is 0. Set it to 1. |
| Camera never starts on the phone | Page is not on `https://`, or permission was denied. |
| One student checking in blocks the class | Only possible with an old build; limits are keyed per account, not per IP. |
| `ER_ACCESS_DENIED` / `ETIMEDOUT` on boot | Using the internal host from outside Railway, or `DB_SSL` not `true`. |
| Migrations fail on first deploy | Step 2 was skipped — an empty database has no tables to migrate. |
| 404 on a page after refresh | Old build without the SPA history fallback. |

## Rolling back

Railway keeps previous deployments: **Deployments** → pick the last good one → **Redeploy**.

Note that migrations are **forward-only**. Rolling the code back does not roll the schema back,
which is safe for additive migrations (all of the current ones) but means a future destructive
migration needs its own reversal path.

## Free alternatives

If Railway's credit runs out, the `Dockerfile` is portable. A workable free combination:

- **Web service** — Render free tier, or Fly.io. Both build from the same `Dockerfile`. Render's
  free instances sleep when idle, so the first request after a pause is slow; fine for a viva
  demo, poor for a real class.
- **Database** — any managed **MySQL** (Aiven and TiDB Cloud Serverless both have free MySQL-
  compatible offerings). Set `DB_SSL=true`. Do **not** substitute PostgreSQL: the data layer is
  MySQL-specific.

Whatever you choose, `TRUST_PROXY_HOPS` must still match that platform's proxy count, and the
network factor still needs the campus public egress IP.
