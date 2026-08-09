# SSAS — Smart Student Attendance System

Capstone 2 implementation of the design documented in the Capstone 1 proposal and individual
report: a web-based attendance system where a check-in only counts once **three independent
signals agree** — a dynamic, time-limited QR code, GPS geofencing, and institutional network
verification.

## Stack

- **Backend**: Node.js + Express, MySQL (`mysql2`), JWT (HS256, access + httpOnly-cookie refresh),
  bcrypt, `qrcode`, `exceljs`/`pdfkit` for reports.
- **Frontend**: React (Vite), React Router, Axios, `html5-qrcode`, Bootstrap.
- **Database**: MySQL/MariaDB, plain SQL schema (no ORM) — see `server/src/db/schema.sql`.

## Prerequisites

- Node.js 18+ (tested on Node 22)
- A MySQL-compatible server on `127.0.0.1:3306` with a `root` user and **no password** (XAMPP's
  default). If you use XAMPP, start MySQL from the XAMPP control panel.
  - ⚠️ **Port conflict note**: if you also have the `MySQL80` Windows service installed, it binds
    the same port 3306 and will make XAMPP's MySQL fail to start (or vice versa — whichever one
    grabbed the port first "wins" and the other's client will get `Access denied`/`ECONNREFUSED`
    depending on which is actually listening). Only run one of them at a time:
    `services.msc` → `MySQL80` → Stop, then start XAMPP's MySQL module.

## First-time setup

```bash
# 1. Backend deps + database schema + seed demo accounts
cd server
npm install
cp .env.example .env        # defaults already match a stock XAMPP install
npm run db:init             # creates the `ssas` database, tables, and 3 demo accounts

# 2. Frontend deps
cd ../client
npm install
```

### Changing the schema later

`db:init` is a **factory reset** — `schema.sql` drops every table. It now refuses to run
against a database that already contains data, and tells you what it would have destroyed.
To change the schema of a database that is in use, add a file under
`server/src/db/migrations/` and run:

```bash
npm run db:migrate    # applies anything pending, records it in schema_migrations
npm run db:status     # lists applied / pending migrations
npm run db:check      # read-only integrity report (roles, orphans, retention, hash cost)
```

### Testing the whole system

```bash
npm run test:system   # 163 checks against the running API (start `npm run dev` first)
```

Drives the live API over HTTP exactly as a browser does, covering authentication, role
boundaries, all three verification factors, duplicate prevention, the audit trail, manual
marking, reports, and the non-functional targets. It reads the database directly only to mint
genuinely valid QR codes (it needs the session's `qr_secret`) and to assert side effects the
API does not expose — such as the database rejecting a duplicate insert made behind the API's
back.

It records every table's row count on entry, tags everything it creates, and deletes all of it
afterwards, then re-asserts those counts. Safe to run against a database with real data in it.

A fresh `db:init` and a fully migrated database produce identical schemas.

`npm run db:init` prints three ready-to-use accounts (all share one password):

| Role    | Email                | Password      |
|---------|-----------------------|---------------|
| Admin   | admin@ssas.local      | Password123!  |
| Teacher | teacher@ssas.local    | Password123!  |
| Student | student@ssas.local    | Password123!  |

A demo course (`CSIT301`) is created and the demo student is already enrolled in it.

**Students can also sign in with their college ID** instead of an email — the seeded student's
is `23012003`. Staff sign in with their email; only students have a college ID, so the two
namespaces cannot collide.

### Administrators

An administrator can **never** be self-registered. Every route that creates or promotes one
requires an existing admin, verified five ways: public register, student, teacher,
unauthenticated, and role-promotion are all refused.

That leaves the bootstrap — the first admin cannot come from inside the application. Use:

```bash
npm run admin:create -- --email you@college.edu --name "Your Name"
```

It prompts for the password rather than taking it on the command line, so it stays out of
shell history. This path requires shell access to the server, which is already a higher
privilege than any application role, so it grants nothing an attacker could not otherwise do.

> ⚠️ `db:init` seeds `admin@ssas.local` with the password printed below — **published in this
> file**. Fine for local development; a live deployment left on it is the most likely way this
> system gets taken over. `npm run db:check` warns whenever any account still uses it.

### Accounts are issued, not signed up for

Public self-registration is **closed by default** (`ALLOW_PUBLIC_REGISTRATION=false`). Attendance
records are keyed to the institutional student number, so an account the college did not issue
corresponds to nobody on any roster. Accounts are created by an admin — individually from
**Users → Add user**, or in bulk by pasting spreadsheet columns into **Users → Import students**.
Set `ALLOW_PUBLIC_REGISTRATION=true` to reopen the sign-up form for a standalone demo.

Enrolment is likewise **not self-service**: it decides who appears in the official attendance
report, so it belongs to an admin or the course's own teacher (**Courses → Roster**).

## Running it

Two terminals:

```bash
# Terminal 1 — API on http://localhost:5000
cd server
npm run dev

# Terminal 2 — SPA on http://localhost:5173 (proxies /api to the server above)
cd client
npm run dev
```

Open **http://localhost:5173**. Log in as any of the seeded accounts above.

## Trying the full attendance flow

1. Log in as **teacher**, go to your course → **Start session**. Optionally click "Use my current
   location" to set the geofence centre to wherever you actually are (useful for testing on a
   phone/laptop with location on) — otherwise type any lat/lng. Leave the subnet as `any` for local
   testing (see note below).
2. On the **Live Session** screen the QR code replaces itself on the schedule you chose when
   creating the session (**Code expires after**, 10–300 seconds, default 30), with a countdown
   showing how long the current code has left.
3. On a phone (or a second browser tab logged in as **student**), open **Scan attendance QR**,
   scan the code, and allow the location permission prompt. You should see either a success
   message or a specific rejection reason (expired QR, out of geofence, wrong network, duplicate).
4. Back on the teacher's Live Session screen, the roster updates automatically. **Failed
   attempts are shown too**, grouped by reason — so an empty roster tells you *why* nobody is
   checking in rather than leaving you guessing.
5. If a student genuinely cannot scan (Wi-Fi down, flat battery), use **Mark present** beside
   their name. This is recorded as a manual mark in your name with an optional reason, stored
   with all three check flags set to `0`, and is shown as `MANUAL` everywhere — including on
   reports. It never masquerades as a verified scan. The register can still be corrected after
   the session has ended.
6. Try **Reports** on the teacher dashboard for a PDF/Excel export of a date range; the export
   distinguishes verified scans from manual marks.

### Testing from a phone

`npm run dev` binds to localhost only, and `getUserMedia` (the QR scanner) plus geolocation are
both gated behind a **secure context** — a plain `http://192.168.x.x` origin is not one, so the
camera silently refuses to start. Use:

```bash
cd client && npm run dev:lan     # serves over HTTPS on the machine's LAN address
```

Then open `https://<your-lan-ip>:5173` on the phone and accept the self-signed certificate
warning (**Advanced → Proceed**). The port may also need an inbound firewall rule.

### About the network-authentication check

Browsers cannot read a device's Wi-Fi SSID — this is a real platform limitation, not something
this build works around. The report's own analysis (Section 4.9.5) treats SSID-matching as
unavailable in practice and falls back to matching the request's **source IP against an
authorised subnet**, which is what this build does. When creating a session:

- Leave **Authorised subnet** as `any` to accept any network (useful when testing locally, since
  your browser and the server are on the same machine/LAN and there's no real "campus subnet" to
  check against).
- On a real deployment, set it to the institution's actual Wi-Fi subnet in CIDR form, e.g.
  `192.168.1.0/24`.
- Loopback (`::1`/`127.0.0.1`) is **not** silently authorised. It used to be, which quietly
  disabled the third factor for anything reaching the server locally — and inconsistently, since
  `::1` passed while `127.0.0.1` did not. Local testing is served by the `any` subnet instead.
  Set `NETWORK_TRUST_LOOPBACK=true` to opt back in.

The **SSID** field on a session is kept only as a human-readable label for the teacher — it is
not used as an automated check, for the reason above.

> This was true of the design but **not** of the code until recently: `verifyNetwork` checked the
> submitted SSID *first* and returned pass on a match, before the IP was ever examined. Since a
> browser cannot read an SSID, that value could only have come from the request body — so anyone
> who knew the campus network's name (public information) could send `{"ssid":"Campus_WiFi"}`
> from anywhere on the internet and satisfy the network factor outright. The SSID is now ignored
> entirely; only the connection's source IP is used, which the client cannot choose.

## Deploying to a real server

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full walkthrough (Railway + managed
MySQL, with a portable `Dockerfile` that also runs on Fly.io, Render or a VPS).

In production the API also serves the built SPA, so the whole system is one container on one
HTTPS origin. Three things behave differently once it leaves localhost, and all three are
covered in the guide:

- **The network factor stops matching internal subnets.** Students reach an internet-hosted
  server through the campus NAT, so it sees the college's *public egress* IP — a `192.168.x`
  range can never match, and every check-in would fail `NETWORK_UNAUTHORISED`.
- **HTTPS is mandatory.** The camera and geolocation both require a secure context; over plain
  HTTP the student page cannot work at all.
- **`TRUST_PROXY_HOPS` must be set explicitly.** It decides which address the network factor
  and the rate limiter see. The app refuses to start in production until it is set, because
  there is no safe default — too low breaks the factor, too high lets clients spoof it.

Production bootstrap uses `npm run db:init -- --no-seed`, which creates the schema **without**
the demo accounts — otherwise a public deployment would ship three working logins whose
password is printed in this file, one of them an administrator.

## Known trade-offs (by design, not oversights)

- **No native mobile app** — a responsive web app was chosen deliberately (Section 1.4.2 of the
  report); QR scanning and geolocation both work from a phone's browser.
- **Access tokens live in memory only**; the refresh token is an httpOnly cookie the client JS
  can never read. This means a hard page reload re-authenticates silently via the cookie, but
  closing and reopening the browser in a way that drops cookies (e.g. private browsing ending)
  requires logging in again — a deliberate trade against storing tokens in `localStorage`.
- **Geofence/network checks are necessary-but-individually-spoofable signals**, same as the
  report's own literature review concludes (Section 2.4/2.5) — the security property comes from
  requiring all three checks in one server-side transaction, not from any one of them being
  unbeatable alone.

## Project layout

```
server/   Express API — see src/services for the QR/geofence/network/attendance logic
          (mirrors the report's pseudocode in Sections 4.9.1-4.9.6 closely)
client/   React SPA — src/pages/{student,teacher,admin} split by role
```

## Auditability

Only the check-ins that *succeeded* used to be stored, so a failure left no trace: a student
insisting they had tried had nothing to point at, and a teacher facing an empty roster could not
tell "nobody scanned" from "everyone scanned and the network refused them".

Every attempt is now recorded in `attendance_attempts` — including successes — with which of the
three checks passed, failed, or was **skipped**. Skipped is meaningful: the checks short-circuit
in order, so a geofence failure means the network check never ran, and recording it as `failed`
would blame infrastructure that was never consulted. Failures are surfaced per session to the
teacher and institution-wide to administration. Kept in a separate table from
`attendance_records` on purpose: reports read the existence of an attendance record as PRESENT,
so storing failures there would make every failed attempt count as attendance.

Manual marks are equally distinguishable — `marked_by` names the teacher, `mark_reason` records
why, and the three check flags are stored as `0`. Administration sees the manual share of the
whole record as a trust signal.

## Security notes for graders / reviewers

- Passwords: bcrypt, 12 rounds — asserted by `npm run db:check`, because the seed script had
  drifted to cost 10 while the application used 12.
- Tokens: JWT HS256, 15-minute access / 7-day refresh, refresh tokens hashed at rest and
  revoked on logout/rotation. Rotation allows a **30-second reuse grace window**
  (`REFRESH_ROTATION_GRACE_MS`): the live-session screen polls every few seconds, so a poll's
  refresh could rotate the cookie at the instant the next page booted with the value it had just
  read, and the loser was logged out mid-lesson for doing nothing wrong. A token replayed long
  after rotation is still refused — that is the case worth treating as theft.
- Login accepts an email **or** a student number. An unknown identifier is compared against a
  dummy hash so a miss costs the same ~100 ms as a hit; returning early would have made response
  time an account-enumeration oracle and undone the identical `Invalid credentials` message.
- `trust proxy` is left disabled by default (`TRUST_PROXY_HOPS=0`) — enabling it blindly would
  let a client spoof `X-Forwarded-For` and defeat both rate limiting and the network-auth subnet
  check; only set it if this is deployed behind a real, counted reverse-proxy chain.
- `npm audit` on the backend flags advisories in `bcrypt`'s and `exceljs`'s *transitive*
  install/build tooling (`@mapbox/node-pre-gyp`→`tar`, `archiver`→`glob`/`brace-expansion`). These
  are triggered by extracting trusted prebuilt binaries/writing zip files at install/report-time,
  not by handling attacker-controlled archives at runtime, so they were left as-is rather than
  force-installing breaking major-version bumps of `bcrypt`/`exceljs`. Worth revisiting before a
  real production deployment.
