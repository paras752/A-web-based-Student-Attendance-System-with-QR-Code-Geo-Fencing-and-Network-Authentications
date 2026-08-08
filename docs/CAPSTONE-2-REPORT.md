# CAPSTONE II — IMPLEMENTATION REPORT

**Title:** A Web-based Student Attendance System with QR Code, Geo-Fencing and Network Authentications

**Author:** Paras Thapa — Project Leader; Backend, Database & Authentication Developer
**Supervisor:** Hemanta Acharya
**Group:** Group 2 — IIMS College
**Date:** 2026

---

> **Note on this document.** This is a working draft assembled from the implementation record:
> every figure quoted was measured against the running system, and every defect described was
> reproduced before it was fixed. It should be reviewed, rewritten in your own voice, and
> checked against your submission rubric before use. You will be expected to defend each claim
> in the viva, so read Chapter 4 carefully — the numbers are real and reproducible with the
> commands given.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Implementation](#2-system-implementation)
3. [Deviations from the Capstone-I Design](#3-deviations-from-the-capstone-i-design)
4. [Testing and Results](#4-testing-and-results)
5. [Discussion and Limitations](#5-discussion-and-limitations)
6. [Conclusion](#6-conclusion)
7. [Appendices](#7-appendices)

---

# 1. Introduction

## 1.1 Purpose of this Report

Capstone-I delivered an analysis and a design: requirements, diagrams, and pseudocode for six
core algorithms. It stated plainly that what it had *not* delivered was "a working, tested
implementation of this design" (§5).

This report covers that implementation. It describes the system as built, records where the
build departed from the Capstone-I design and why, and presents the measured results of
testing it. Where the design and the implementation disagree, this report says which one was
wrong — and in two cases the answer is the design.

## 1.2 Summary of What Was Built

A three-tier web application implementing the three-factor attendance verification specified in
Capstone-I: a dynamic signed QR code, GPS geofencing, and institutional network verification,
all evaluated server-side within a single request before any attendance is written.

| Layer | Technology | Size |
|---|---|---|
| Presentation | React 19 (Vite), React Router, Axios, `html5-qrcode` | 24 components, ~5,800 lines |
| Application | Node.js + Express, JWT (HS256), bcrypt, `qrcode`, `pdfkit`, `exceljs` | 40 modules, ~3,600 lines |
| Data | MySQL / MariaDB 10.4, plain SQL, no ORM | 12 tables, 11 migrations |

All 15 functional requirements are addressed; 14 are implemented as specified and one (FR01,
self-registration) is deliberately implemented differently for reasons given in §3.3. All 10
non-functional requirements were tested, and those stated as numbers were measured.

## 1.3 Principal Findings

The most significant outcome of the implementation phase was not that the design worked, but
that building it exposed defects **in the design itself**:

1. **The network-authentication algorithm specified in §4.9.5 of the Capstone-I report contains
   a bypass** that allows any caller to satisfy one of the three verification factors by
   asserting it. This was reproduced against the running system.
2. **The report-generation algorithm in §4.9.6 silently omits the final day of any date range**,
   due to a `BETWEEN` comparison against `DATETIME` values.
3. **The API design in Table 3.3 specifies an unauthenticated endpoint that creates teacher
   accounts**, which was confirmed to be exploitable.

These are discussed in Chapter 3. Capstone-I's own conclusion argued that "the validity of any
attendance validation depends on the weakest point"; the implementation phase demonstrated that
principle against the design that stated it.

---

# 2. System Implementation

## 2.1 Architecture as Built

The n-tier separation described in §3.2.8 was implemented as specified. A request traverses:

```
Browser (React SPA)
   │  HTTPS / JSON, JWT bearer token
   ▼
Express middleware  →  helmet, CORS, body parsing, cookie parsing
   │
   ▼
Route layer         →  express-validator schemas, requireAuth, roleGuard
   │
   ▼
Controller layer    →  thin; translates HTTP into service calls
   │
   ▼
Service layer       →  all business logic (auth, qr, geofence, network,
   │                    attendance, session, course, report, admin,
   │                    maintenance, backup)
   ▼
Data-access         →  parameterised mysql2 queries
   ▼
MySQL
```

No business logic exists in the route handlers or in the client. Verification is server-side
without exception, which is what makes the client's inability to bypass it structural rather
than a matter of trust.

**Directory layout (server):**

```
src/
  app.js                  Express assembly, middleware order, trust-proxy policy
  server.js               Listener, background maintenance, scheduled backups
  config/                 env.js (single source for all configuration), db.js (pool)
  middleware/             auth.js, roleGuard.js, validate.js, rateLimit.js, errorHandler.js
  controllers/            auth, course, session, attendance, report, admin
  services/               auth, course, session, attendance, qr, geofence, network,
                          report, admin, maintenance, backup
  utils/                  jwt.js, haversine.js, subnet.js, asyncHandler.js
  db/                     schema.sql, init.js, migrate.js, check.js, create-admin.js,
                          migrations/*.sql
```

## 2.2 Database Implementation

### 2.2.1 Schema

Twelve tables. The six entities of the Capstone-I ER diagram (Figure 4.5) are all present; six
further tables were added during implementation for concerns the design did not model.

| Table | Cols | Origin | Purpose |
|---|---|---|---|
| `users` | 7 | Fig 4.5 | Accounts and roles |
| `students` | 6 | Fig 4.5 | Student detail; `student_number` is the login identifier |
| `teachers` | 4 | Fig 4.5 | Staff detail |
| `courses` | 7 | Fig 4.5 | Courses; FK to `teachers(user_id)` |
| `enrolments` | 4 | Fig 4.5 | Student↔course, `UNIQUE(student_id, course_id)` |
| `sessions` | 16 | Fig 4.5 | Class sessions, geofence, QR secret, network policy |
| `attendance_records` | 14 | Fig 4.5 | One row per recorded attendance |
| `devices` | 4 | Fig 4.5 | Hashed device fingerprints (§2.2.4) |
| `qr_codes` | 4 | Fig 4.5 | Code issuance log (§2.2.4) |
| `attendance_attempts` | 11 | **new** | Every check-in attempt, including failures (§2.5) |
| `refresh_tokens` | 6 | **new** | Server-side refresh tokens, hashed, revocable |
| `schema_migrations` | 3 | **new** | Applied-migration ledger (§2.2.2) |

### 2.2.2 Migration System

`schema.sql` drops every table before recreating it. That is correct for a first install and
catastrophic once a database holds real accounts and attendance records — a fact established
during development when the seed script, aimed at a scratch database, destroyed the working one
because `schema.sql` hardcoded `USE ssas` and silently ignored the configured database name.

Two changes followed:

- **`schema.sql` no longer names a database.** `db:init` creates and selects the database named
  by `DB_NAME`, so the target cannot disagree with the configuration.
- **`db:init` refuses to run against a non-empty database**, listing what it would have
  destroyed, and requires an explicit `--force`.

Schema changes now go through forward-only migrations recorded with a SHA-256 checksum, so an
applied migration cannot be edited without detection. Eleven have been applied:

| # | Migration | Purpose |
|---|---|---|
| 001 | `indexes` | `refresh_tokens.token_hash`; composite `sessions(course_id, start_time)` |
| 002 | `course_teacher_fk` | Repoint `courses.teacher_id` at `teachers(user_id)` |
| 003 | `updated_at` | Modification timestamps on five mutable tables |
| 004 | `session_ended_at` | Preserve scheduled `end_time` when a session closes early |
| 005 | `session_room` | Human-readable room label |
| 006 | `manual_attendance` | `marked_by`, `mark_reason` (§2.6) |
| 007 | `attendance_attempts` | Failed-attempt audit trail (§2.5) |
| 008 | `session_qr_validity` | Per-session QR lifetime |
| 009 | `attendance_coordinates` | FR07 — store GPS position, not only distance |
| 010 | `devices` | Devices entity from Fig 4.5 |
| 011 | `qr_codes` | QR issuance log from Fig 4.5 |

A fresh `db:init` and a fully migrated database were verified to produce **byte-identical
schemas** (89 of 89 matching column, index and foreign-key definitions), so the two paths cannot
drift.

### 2.2.3 Integrity

`npm run db:check` is a read-only report asserting fifteen invariants that constraints alone
cannot express — for example, that no attendance record exists for a course the student is not
enrolled in, and that every `SUCCESS` attempt has a matching attendance record. It exits
non-zero on failure, so it can be wired into a pre-demonstration checklist.

Referential integrity is enforced by **12 foreign-key columns**. This was verified by attempting
inserts directly against the database, bypassing the application entirely (§4.3).

### 2.2.4 Devices and QR-CODE Entities

Both appear in Figure 4.5 and were implemented in migrations 010 and 011, with one deliberate
deviation.

**Devices** stores a SHA-256 fingerprint of (client IP + user agent), never the raw values — the
fingerprint only needs to be comparable, and storing its inputs would turn an attendance log
into a browsing-history log. `attendance_records.device_id` uses `ON DELETE SET NULL`: removing
a device record must never delete the attendance it witnessed.

**QR-CODE** records `session_id`, `generated_at` and `expires_at`. The `codeValue` attribute
shown in Figure 4.5 is **not stored**. A stored code value is a live credential, and a table of
them is a list of tokens that currently work. Verification recomputes the expected HMAC from the
session secret (§4.9.3), so no lookup is ever required. The audit value of the entity — how many
codes a session issued, over what window — is retained without the liability.

## 2.3 Authentication Module

Implemented as specified in §3.2.1, with three additions arising from implementation.

| Property | Implementation |
|---|---|
| Password hashing | bcrypt, cost 12, from a single definition in `config/env.js` |
| Access token | JWT HS256, 15 minutes, held in memory only |
| Refresh token | JWT HS256, 7 days, httpOnly cookie, **hashed at rest**, revocable |
| Rotation | Old token revoked on every refresh |
| Login identifier | Email **or** institutional student number (FR02) |

**Addition 1 — timing parity.** Supporting two identifier namespaces made the login lookup a
single query, but an unknown identifier returned before any bcrypt work while a known one spent
~100 ms hashing. That difference is measurable, and it converts response time into an
account-enumeration oracle — undoing the identical `"Invalid credentials"` message §4.9.1
specifies for exactly that reason. An unknown identifier is now compared against a dummy hash.
Measured: **236 ms known vs 235 ms unknown**.

**Addition 2 — rotation grace window.** Rotating the refresh token on every use created a race:
the live-session screen polls every four seconds, so a poll's refresh could rotate the cookie at
the instant the next page booted holding the value it had read moments earlier. The loser
presented a token revoked milliseconds ago and was signed out mid-lesson. A 30-second reuse
grace absorbs the race; a token replayed long after rotation is still refused, which is the case
worth treating as theft.

**Addition 3 — bootstrap path.** Every route that can create an administrator requires an
existing administrator. That is correct, but it leaves the first one, which `db:init` seeds with
a password published in the project README. `npm run admin:create` provisions an administrator
out-of-band, prompting for the password so it does not enter shell history. `db:check` warns
whenever any account still uses the seed password.

## 2.4 Three-Factor Verification

Implemented as one server-side transaction, short-circuiting in the order given in §4.9.2 —
cheapest check first, so a rejection never pays for the checks after it.

### 2.4.1 QR Code (§3.2.2, §4.9.3)

Payload is `{sessionId, timestamp, signature}` where the signature is
`HMAC-SHA256(session.qr_secret, sessionId + timestamp)`. The secret is generated per session
from 32 cryptographically random bytes and **never leaves the server** — verified by asserting
its absence from every API response.

Verification recomputes the signature and compares with `crypto.timingSafeEqual`. Expiry is
checked before the signature, and a *future*-dated timestamp is rejected as well as an old one,
so a hand-crafted payload cannot buy itself a longer life.

**Change from the design:** the validity window is per-session (10–300 s, default 30) rather
than a global 30 s constant, for the same reason §4.9.4 already gives for making the geofence
radius per-session: a lecture hall and a tutorial room are not the same problem. A longer window
is also exactly how long a photograph of the screen remains usable, so the interface warns the
teacher when the value exceeds 120 seconds.

### 2.4.2 Geofencing (§3.2.4, §4.9.4)

Haversine great-circle distance against the session's centre and radius, default 50 m per NFR07.
Coordinates are now validated as **bounded** (`lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`); previously
any float was accepted, so `lat: 999` reached the distance calculation instead of being rejected
as malformed.

Per FR07, the position itself is stored alongside the derived distance. A stored distance cannot
be re-checked later; the coordinates it came from can.

### 2.4.3 Network Authentication (§3.2.5, §4.9.5)

**This is the factor whose specified algorithm was found to be defective.** See §3.1.

As built, the check uses **only the source IP of the request**, matched against the session's
authorised subnet in CIDR form. The source IP is the peer address of the TCP connection: a
browser client cannot set it, and `trust proxy` is disabled by default so `X-Forwarded-For`
cannot override it.

The SSID is not consulted. `authorised_ssid` survives as a human-readable label for the teacher.

## 2.5 Attempt Auditing

Capstone-I §3.2.6 argued that recording the result of each verification step separately — rather
than a single true/false — answers the auditability problem Ishaq & Bibi (2023) identify. In
practice a record was written *only on success*, so the three per-check columns were constant
`1` on every row and carried no information at all. A failure left no trace: a student insisting
they had tried had nothing to point at, and a teacher facing an empty roster could not
distinguish "nobody scanned" from "everyone scanned and the network refused them".

`attendance_attempts` now records **every** attempt, successes included, with each check marked
`passed`, `failed` or **`skipped`**. The third value is the important one: the checks
short-circuit, so a geofence failure means the network check never ran, and recording it as
`failed` would blame infrastructure that was never consulted.

The table is separate from `attendance_records` deliberately — reports read the existence of an
attendance record as PRESENT, so storing failures there would make every failed attempt count as
attendance.

Failures are surfaced per-session to the teacher and institution-wide to administration, each
translated into an action. Logging swallows its own errors: losing a diagnostic row is a bad day,
refusing a valid check-in because of one is worse.

## 2.6 Manual Attendance

Not in the Capstone-I requirements, added because the three factors have a failure mode the
design does not address: campus Wi-Fi drops, a phone is flat, a camera will not focus. Without
an override, the honest answer for a student visibly sitting in the room is "absent", which
makes the report wrong.

A teacher may mark a student present, but a manual mark is **never** indistinguishable from a
verified scan:

```
manual mark  →  qr=0  geo=0  net=0,  marked_by = <teacher>,  mark_reason = '<why>'
verified scan → qr=1  geo=1  net=1,  marked_by = NULL
```

Writing `0` to the three flags is what finally gives those columns meaning. The distinction
propagates to the live roster, the sessions list, the PDF and Excel exports, and an
institution-wide "share of records that are teacher-asserted" figure on the administration
dashboard.

Undo applies to manual marks only. A record produced by a real scan returns `409` — a teacher
able to delete genuine scans would make attendance a matter of opinion.

## 2.7 Reporting (FR13, FR14, §4.9.6)

Implemented per the pseudocode, joining Sessions × Enrolments × AttendanceRecords so that
**absentees are surfaced, not only attendees**, with PDF (`pdfkit`) and Excel (`exceljs`) output.
Exports additionally distinguish verified scans from manual marks, and the summary sheet carries
an "of which manual" column.

Two corrections to the specified algorithm are described in §3.2 and §2.8.

## 2.8 Account Provisioning and Enrolment

Capstone-I specifies open self-registration (FR01, Table 3.3). The build instead treats accounts
and enrolments as institutional records:

- **Registration is closed by default.** Attendance is keyed to the institutional student
  number, so an account the college did not issue corresponds to nobody on any roster.
  `ALLOW_PUBLIC_REGISTRATION=true` reopens it, and even then the role is pinned server-side to
  `student`.
- **Students are provisioned by administration**, individually or by bulk paste of spreadsheet
  columns (up to 500). Rows commit independently so one duplicate does not discard the rest.
- **Students log in with their college ID** or email (FR02).
- **Enrolment is not self-service.** It decides who appears in the official attendance report,
  so it belongs to administration or the course's own teacher.

Rationale and the exploit that motivated it are in §3.3.

## 2.9 Operational Concerns

| Concern | Implementation |
|---|---|
| **NFR10** automated backup | `mysqldump --single-transaction` on boot and every 24 h; 14-day retention; `npm run db:backup` for a manual run |
| Refresh-token growth | 7-day retention, purged every 6 h — the table had reached 561 rows in development |
| Attempt-log growth | 180-day retention (longer: a disputed absence can surface at end of term) |
| Session staleness | `is_active` reconciled with `end_time`; early close records `ended_at` without overwriting the scheduled `end_time` |

---

# 3. Deviations from the Capstone-I Design

Deviations fall into three groups: defects **in the design** found during implementation,
defects **in the implementation** of a correct design, and deliberate design changes. This
chapter covers the first and third; implementation defects are in Chapter 4.

## 3.1 Defect in §4.9.5 — the Network Authentication Algorithm

### The specified algorithm

```
ALGORITHM VerifyNetwork(networkClaim, session)
  IF networkClaim.ssid IS NOT NULL AND
     networkClaim.ssid = session.authorised_ssid THEN
    RETURN { passed: TRUE }          ← returns before the IP is examined
  END IF
  clientSubnet <- extractSubnet(networkClaim.ipAddress)
  ...
```

### Why it fails

`networkClaim.ssid` can only reach the server in the request body. §4.8.4 and §3.2.5 both
acknowledge that browsers do not expose the Wi-Fi SSID to JavaScript — which means the value is
supplied by the caller, and the first branch returns `passed: TRUE` on a caller-supplied string.

Campus network names are public information. Any caller who knows or guesses one satisfies FR09
from anywhere on the internet, defeating the report's central claim (§2.5, §5) that all three
factors must hold within one server-side transaction.

### Evidence

Measured against the implementation before the fix, with a session requiring subnet
`192.168.1.0/24` and label `Campus_WiFi`:

```
PASS  honest student on campus            {"clientIp":"192.168.1.55"}
FAIL  honest student off campus           {"clientIp":"8.8.8.8"}
PASS  ATTACKER off campus, spoofs SSID    {"ssid":"Campus_WiFi","clientIp":"8.8.8.8"}
FAIL  ATTACKER, wrong SSID guess          {"ssid":"Wrong_Guess","clientIp":"8.8.8.8"}
```

The implementation was faithful to the pseudocode. The pseudocode was wrong.

### Correction

```
ALGORITHM VerifyNetwork(request, session)
  // The source IP is the peer address of the TCP connection: the only network signal a
  // browser client cannot choose, and therefore the only one usable as a factor. Any SSID
  // in the request body is a caller-supplied claim and is NOT consulted.
  clientIp <- request.sourceAddress
  IF ipInSubnet(clientIp, session.authorised_subnet) THEN
    RETURN { passed: TRUE }
  END IF
  RETURN { passed: FALSE, reason: "NETWORK_UNAUTHORISED" }
END ALGORITHM
```

Verified after the fix: the spoofed-SSID request returns `403 NETWORK_UNAUTHORISED` and no
attendance record is written.

## 3.2 Defect in §4.9.6 — the Report Generation Algorithm

The specified query filters `start_time BETWEEN dateRangeStart AND dateRangeEnd`. `start_time`
is a `DATETIME`; the bounds are dates, which SQL widens to midnight. The range therefore ends at
`00:00:00` on the final day and **silently drops every session held during it**. A report run
"up to today" omits today's classes.

Measured: the specified form returned **0 sessions** where the corrected form returned **2**.

```
AND start_time >= dateRangeStart
AND start_time <  dateRangeEnd + INTERVAL 1 DAY
```

The same class of error was found and fixed in the teacher dashboard's weekly attendance figure,
where `CURDATE() - INTERVAL 0 DAY` excluded the current day: it displayed **6.7%** where the
true figure was **26.7%**.

## 3.3 Departure from FR01 and Table 3.3 — Registration

Table 3.3 specifies:

| Endpoint | Authorization Required | Role |
|---|---|---|
| `POST /api/v1/auth/register` | Not needed | **Student and teacher** |

An unauthenticated endpoint that creates **teacher** accounts. A teacher can create courses and
sessions — including setting the geofence radius and authorised subnet the checks are measured
against — so anyone able to reach the form could grant themselves control over the attendance
data the system exists to protect.

**Confirmed exploitable.** An account registered with `role: teacher` returned `201` and then
successfully created a course. Two accounts in the development database had already been created
this way before the flaw was noticed.

Defence is now at three layers: the role is pinned server-side to `student`; the validator
rejects any other value; and staff accounts originate only from `POST /admin/users` behind an
admin guard. Registration itself is closed by default, and that check runs *before* validation
so a closed endpoint answers "closed" whatever body it receives, rather than leaking which
payload shapes it would have accepted.

**Proposed replacement FR01:** *The system shall allow an administrator to create student
accounts, individually or by bulk import, recording the institutional student number, name and
email.*

## 3.4 Other Deliberate Changes

| Area | Capstone-I | As built | Reason |
|---|---|---|---|
| FR05 QR lifetime | fixed 30 s | 10–300 s per session, default 30 | Room size varies, as §4.9.4 already argues for the radius |
| Table 4.1 `authorised_ssid` | `NOT NULL` | nullable | No longer a verification input; `NULL` honestly means "no label" |
| Fig 4.5 QR-CODE `codeValue` | stored | not stored | A table of live credentials for no functional gain |
| §3.2.6 FR10 attribution | "Devices/Attendance Records relationship" | `UNIQUE(session_id, student_id)` | As Table 4.1 itself specifies; Devices is evidence, not the constraint |
| Enrolment | implied self-service | administration or owning teacher | Enrolment determines the official register |

---

# 4. Testing and Results

## 4.1 Approach

Testing was performed at three levels, all against the running system rather than mocks:

1. **Service-level** — verification logic driven directly with crafted inputs.
2. **API-level** — HTTP against the live server, including role boundaries and attack paths.
3. **Browser-level** — Playwright driving headless Chromium through real user journeys.

Every test restores the database to the baseline it recorded on entry, so test data never
accumulates in the working database.

## 4.2 Non-Functional Requirements — Measured

| ID | Target | Measured | Result |
|---|---|---|---|
| NFR01 | Renders 360–1920 px | 360 / 768 / 1920 px across 11 pages × 3 roles — **36/36, zero horizontal overflow** | **Pass** |
| NFR02 | Under 3 seconds | **avg 10 ms, worst 16 ms** over 8 runs; 29 ms in final regression | **Pass** (~100× margin) |
| NFR03 | HTTPS + hashed passwords | bcrypt cost 12 verified on every account; HTTPS available via `npm run dev:lan` | **Pass** |
| NFR05 | N-tier layered | Middleware → controller → service → data-access, no logic in routes | **Pass** |
| NFR06 | Modern browsers | Chromium verified automatically; others manual | **Partial** |
| NFR07 | 50 m radius | Default 50 m, per-session override | **Pass** |
| NFR08 | No stack traces | 4 error classes probed — **0 leaks**, all carry readable messages | **Pass** |
| NFR09 | Schema-level integrity | **12 FK columns**; database rejects orphan and duplicate inserts made directly | **Pass** |
| NFR10 | Daily backup | Implemented; verified **88 KB** restorable dump containing schema, data, migration ledger | **Pass** |
| NFR04 | 99% availability | Not measurable in a development environment | **Not assessed** |

The NFR02 margin deserves comment. §2.2 justified Node.js on the basis that verification is
I/O-bound and must complete inside three seconds. At 10 ms average the runtime choice is
vindicated, but the figure measures server-side verification only — it excludes camera focus and
GPS acquisition on the handset, which dominate the experience and are outside the server's
control.

## 4.3 Functional Requirements — Verified

| ID | Verification |
|---|---|
| FR02 | Login by student number (`23012003`) and by email both return 200 |
| FR03 | Teacher login restricted; role drives redirect to the correct dashboard |
| FR04 | Signed QR per session; `qr_secret` absent from every response |
| FR05 | 20 s-old code **expired** on a 15 s session, **accepted** on a 120 s session |
| FR06 | Camera scan verified in-browser |
| FR07 | Latitude and longitude stored (`27.7172`, `85.324`) with distance |
| FR08 | 156 km away → `GEOFENCE_OUT_OF_RANGE`; `lat: 999` → `400` |
| FR09 | Off-subnet → `NETWORK_UNAUTHORISED`; spoofed SSID no longer bypasses |
| FR10 | Duplicate → `409`; **database rejects a duplicate inserted directly**, bypassing the service |
| FR11 | Timestamp plus per-check outcome recorded for every attempt |
| FR12 | History and percentage; per-course breakdown |
| FR13/14 | PDF (`%PDF`, 1,445 B) and Excel (`PK`, 7,515 B); course and date filters |
| FR15 | Administration manages users, roles, courses, rosters, imports |

## 4.4 Security Testing

| Attack | Result |
|---|---|
| Register as teacher/admin | `403` — all five payload shapes return the same status |
| Student/teacher creating an admin | `403` |
| Teacher promoting a user to admin | `403` |
| Unauthenticated admin creation | `401` |
| Forged QR signature | `QR_INVALID` |
| Replayed expired QR | `QR_EXPIRED` |
| Future-dated QR | `QR_EXPIRED` |
| Spoofed SSID | `NETWORK_UNAUTHORISED` |
| Student self-enrolling | `403` |
| Teacher accessing another teacher's course | `403` |
| Cross-role API access (7 routes) | `403` on all |
| Account enumeration by message | Identical `"Invalid credentials"` |
| Account enumeration by timing | 236 ms vs 235 ms |
| Refresh-token replay after rotation | `200` inside 30 s grace, `401` after |
| Deleting a verified scan | `409` |

## 4.5 Defects Found and Fixed

Eighteen defects were found during implementation and testing. Those with security or
data-correctness impact:

| # | Defect | Impact | Source |
|---|---|---|---|
| 1 | SSID bypass in network check | Third factor satisfiable by assertion | **Design (§4.9.5)** |
| 2 | Unauthenticated teacher registration | Privilege escalation; confirmed exploitable | **Design (Table 3.3)** |
| 3 | `BETWEEN` drops final day of range | Reports omit a day's sessions | **Design (§4.9.6)** |
| 4 | Weekly attendance excluded today | 6.7% displayed where truth was 26.7% | Implementation |
| 5 | Seed accounts hashed at bcrypt cost 10 | Weaker than the documented 12 | Implementation |
| 6 | `db:init` destructive with no guard | Destroyed a populated database | Implementation |
| 7 | Loopback silently authorised, inconsistently | Third factor disabled locally; `::1` passed, `127.0.0.1` did not | Implementation |
| 8 | Refresh rotation race | Spurious logout mid-lesson | Implementation |
| 9 | QR interval rebuilt by roster poll | Code never rotated; widened the screenshot window | Implementation |
| 10 | Ended session still rendered a live QR | Finished class indistinguishable from running | Implementation |
| 11 | Early close overwrote `end_time` | Scheduled end destroyed | Implementation |
| 12 | Students could self-enrol | Could enter the official register of any course | Implementation |
| 13 | Unbounded coordinates accepted | `lat: 999` reached the distance calculation | Implementation |
| 14 | Students could edit their own name | Roster identity self-editable | Implementation |
| 15 | Failed attempts not recorded | No audit trail; three check columns constant | Gap |
| 16 | FR07 coordinates not stored | Requirement unmet | Gap |
| 17 | NFR10 backup not implemented | Requirement unmet | Gap |
| 18 | Seed credentials published and live | Default-credential exposure | Gap |

Defect 9 is worth singling out. The teacher's screen polls the roster every four seconds, and
the QR refresh interval depended on the session object that poll replaced — so the interval was
torn down and rebuilt before its 30-second timer could ever fire. The code appeared to rotate
but did not, silently extending the window in which a photograph of the screen stays valid: the
exact vulnerability §2.3 cites Nuhi et al. (2020) and Srivastava et al. (2023) as addressing.
Verified after the fix: **1 QR request in 40 seconds while the roster polled ~10 times**, with
the image demonstrably changing.

## 4.6 Regression Suite

A consolidated regression covering the whole system: **32 checks, all passing**, with the
database returned to baseline exactly. It reads its baseline from the database on entry rather
than hardcoding counts, so rows created by ordinary use are not reported as failures.

---

# 5. Discussion and Limitations

## 5.1 What the Three Factors Do and Do Not Prove

Capstone-I is careful (§2.4, §3.2.4, §3.2.5) that no single factor is authoritative, and
implementation supports that reading — with one correction. The report describes geofencing and
network authentication as "each provid[ing] independent evidence of location" (§5). After
implementation the honest position is narrower:

- **QR** proves possession of a token that was valid within the last *n* seconds. Cryptographic;
  the only factor a client genuinely cannot forge.
- **Geofence** relies on coordinates the browser reports. A rooted device or a mock-location app
  can supply any value. §3.2.4 acknowledges this; it bears repeating because it is the factor
  most likely to be assumed strong.
- **Network** relies on the source IP, which the client cannot set. Strong against a remote
  attacker; it proves the request came from the campus network, not that the person did.

The security property comes from requiring all three together: faking GPS alone achieves
nothing, because the attacker still needs a code valid for the current window (someone in the
room) *and* a source address on the campus subnet.

## 5.2 Limitations

- **No dwell-time verification.** Oke et al. (2022) require presence for 90% of the lecture.
  Capstone-I excludes this as unavailable to a web client (§2.4), and that remains true.
- **Geolocation is client-supplied.** No browser API proves a physical position.
- **Network check requires configuration.** With `CAMPUS_SUBNET`/`authorised_subnet` left at
  `any`, the third factor passes for everyone. This is the correct development default and the
  wrong production one.
- **Browser coverage is partial.** Chromium is verified automatically; Firefox, Edge and Brave
  (NFR06) require manual confirmation.
- **NFR04 availability is unmeasured** — it needs a deployment and an observation period.
- **Load testing was not performed.** NFR02 was measured single-user. §3.1.2 anticipates
  InnoDB key-range contention when a cohort checks in simultaneously; that remains untested.

## 5.3 Reflection on the Design-to-Implementation Gap

The most useful outcome was that three of the most serious defects were in the *design*, not the
code, and all three were invisible until something executed. The SSID bypass reads as reasonable
pseudocode and is refuted only by asking where the value comes from; the `BETWEEN` bug is
correct-looking SQL that fails on a type distinction; the registration endpoint's role column
looks like a convenience.

Capstone-I claimed its design was "completely verifiable in accordance with Chapter 3" (§4.10).
Internally consistent it was — but internal consistency is not the same as correctness, and no
amount of diagram review would have surfaced any of the three. This is the strongest argument
the project produces for its own methodology: the report's thesis is that verification requires
multiple independent signals, and the design phase was a single signal.

---

# 6. Conclusion

The design specified in Capstone-I has been implemented, tested and measured. Fourteen of
fifteen functional requirements are implemented as specified; the fifteenth (FR01) is
implemented differently because the specified behaviour was a privilege-escalation
vulnerability. Nine of ten non-functional requirements were verified, several by direct
measurement, with NFR02 exceeding its target by roughly two orders of magnitude.

Implementation produced three findings the design phase could not:

1. The network-authentication algorithm as published could be satisfied by assertion.
2. The reporting algorithm silently omitted a day from every range.
3. The API design permitted unauthenticated creation of privileged accounts.

Each was reproduced, fixed, and re-verified. Corrected pseudocode and requirement wording are
supplied in `docs/REPORT-CORRECTIONS.md` for incorporation into the final documentation.

Beyond conformance, implementation added capabilities the design did not anticipate but which
proved necessary: an audit trail of *failed* attempts — without which an empty roster is
indistinguishable from a broken network — and a manual override for when the automated checks
cannot run, recorded so that a teacher's assertion can never be mistaken for a verified scan.
Both serve the auditability goal §3.2.6 sets out, more directly than the mechanism it proposed.

The system runs, the three factors hold, and where they cannot, it says so rather than guessing.

---

# 7. Appendices

## Appendix A — REST API

Base URI `/api/v1`. Roles enforced by `requireAuth` + `roleGuard`.

**Authentication**

| Method | Endpoint | Role |
|---|---|---|
| POST | `/auth/register` | — (disabled by default) |
| POST | `/auth/login` | All |
| POST | `/auth/refresh` | Valid refresh cookie |
| POST | `/auth/logout` | All |
| GET | `/auth/me` | All |
| POST | `/auth/me/password` | All |
| GET | `/auth/status` | Public |

**Sessions**

| Method | Endpoint | Role |
|---|---|---|
| POST | `/sessions` | Teacher |
| GET | `/sessions/active` | Student |
| GET | `/sessions/overview` | Teacher |
| GET | `/sessions/mine`, `/sessions/my-courses` | Teacher |
| GET | `/sessions/:id/qr`, `/:id/live` | Teacher (owner) |
| PATCH | `/sessions/:id/end` | Teacher (owner) |
| POST/DELETE | `/sessions/:id/attendance[/:studentId]` | Teacher (owner) |

**Attendance & Courses**

| Method | Endpoint | Role |
|---|---|---|
| POST | `/attendance/verify` | Student |
| GET | `/attendance/history`, `/attendance/summary` | Student |
| GET | `/attendance/reports` | Teacher / Admin |
| GET | `/courses`, `/courses/all` | All / Staff |
| GET/POST/DELETE | `/courses/:id/roster`, `/:id/enrol[/:studentId]` | Teacher (owner) / Admin |

**Administration** — all Admin

`GET /admin/analytics` · `GET /admin/users` · `GET /admin/users/:id` · `POST /admin/users` ·
`POST /admin/students/import` · `PATCH /admin/users/:id/profile` ·
`PATCH /admin/users/:id/role` · `PATCH /admin/users/:id/student-number` ·
`POST /admin/users/:id/reset-password` · `DELETE /admin/users/:id`

## Appendix B — Operational Commands

```bash
npm run dev            # API with reload
npm run db:init        # Factory reset — refuses on a non-empty database
npm run db:migrate     # Apply pending migrations
npm run db:status      # Applied / pending
npm run db:check       # Integrity report (15 invariants) + seed-password warning
npm run db:backup      # Manual backup (NFR10)
npm run admin:create   # Provision the first administrator out-of-band

cd client
npm run dev            # SPA, localhost
npm run dev:lan        # HTTPS on the LAN — required for phone camera/GPS
```

## Appendix C — Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BCRYPT_ROUNDS` | 12 | Password hashing cost (app **and** seed) |
| `JWT_ACCESS_EXPIRES_IN` / `REFRESH` | 15m / 7d | Token lifetimes |
| `REFRESH_ROTATION_GRACE_MS` | 30000 | Rotation race tolerance |
| `QR_VALIDITY_WINDOW_SECONDS` | 30 | Fallback QR lifetime |
| `DEFAULT_GEOFENCE_RADIUS_M` | 50 | NFR07 |
| `MINIMUM_ATTENDANCE_PERCENT` | 75 | Attendance floor |
| `CAMPUS_SUBNET` | any | Login-screen indicator only |
| `NETWORK_TRUST_LOOPBACK` | false | Opt-in loopback exemption |
| `ALLOW_PUBLIC_REGISTRATION` | false | Self-registration |
| `BACKUPS_ENABLED` | true | NFR10 |
| `TRUST_PROXY_HOPS` | 0 | Counted trusted proxies |

## Appendix D — Notes for the Viva

Claims most likely to be challenged, and the evidence:

- *"The three factors cannot be bypassed individually."* True as built — demonstrate the
  spoofed-SSID request returning `NETWORK_UNAUTHORISED`. Be ready to say that this was **not**
  true of the published design, and why.
- *"Geofencing proves the student is in the room."* It does not. Say so first; it is a stronger
  position than being corrected.
- *"NFR02 is met."* 10 ms average server-side. State the exclusion: camera and GPS acquisition
  are not included and dominate the user's experience.
- *"The system is secure."* Avoid unqualified claims. The demonstrable statement is that all
  three factors are enforced server-side in one transaction, no client input is trusted, and
  every failed attempt is recorded.
- **Before demonstrating:** run `npm run db:check`, set `CAMPUS_SUBNET`, and be aware the seeded
  accounts still use the password published in the README.
