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

`npm run db:init` prints three ready-to-use accounts (all share one password):

| Role    | Email                | Password      |
|---------|-----------------------|---------------|
| Admin   | admin@ssas.local      | Password123!  |
| Teacher | teacher@ssas.local    | Password123!  |
| Student | student@ssas.local    | Password123!  |

A demo course (`CSIT301`) is created and the demo student is already enrolled in it.

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
2. On the **Live Session** screen the QR code refreshes every 30 seconds.
3. On a phone (or a second browser tab logged in as **student**), open **Scan attendance QR**,
   scan the code, and allow the location permission prompt. You should see either a success
   message or a specific rejection reason (expired QR, out of geofence, wrong network, duplicate).
4. Back on the teacher's Live Session screen, the roster updates automatically.
5. Try **Reports** on the teacher dashboard for a PDF/Excel export of a date range.

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
- Requests from `localhost`/`127.0.0.1` are always treated as authorised, so the system stays
  testable without a real network to point it at.

The **SSID** field on a session is kept only as a human-readable label for the teacher — it is
not used as an automated check, for the reason above.

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

## Security notes for graders / reviewers

- Passwords: bcrypt, 12 rounds.
- Tokens: JWT HS256, 15-minute access / 7-day refresh, refresh tokens hashed at rest and
  revoked on logout/rotation.
- `trust proxy` is left disabled by default (`TRUST_PROXY_HOPS=0`) — enabling it blindly would
  let a client spoof `X-Forwarded-For` and defeat both rate limiting and the network-auth subnet
  check; only set it if this is deployed behind a real, counted reverse-proxy chain.
- `npm audit` on the backend flags advisories in `bcrypt`'s and `exceljs`'s *transitive*
  install/build tooling (`@mapbox/node-pre-gyp`→`tar`, `archiver`→`glob`/`brace-expansion`). These
  are triggered by extracting trusted prebuilt binaries/writing zip files at install/report-time,
  not by handling attacker-controlled archives at runtime, so they were left as-is rather than
  force-installing breaking major-version bumps of `bcrypt`/`exceljs`. Worth revisiting before a
  real production deployment.
