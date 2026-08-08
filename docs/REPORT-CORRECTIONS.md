# Report corrections for Capstone 2

Places where the **Capstone-I Individual Report** and the built system disagree, with
replacement text. Each entry says which is wrong — the report or the code — because they are
not all the same direction.

Two of these are security defects **specified by the report**. The implementation was faithful
to the pseudocode; the pseudocode was wrong. That is worth saying plainly in Capstone 2: a
design flaw found during implementation is a legitimate finding, and Section 5 already frames
the project around exactly this idea ("the validity of any attendance validation depends on
the weakest point").

---

## 1. §4.9.5 Network Authentication Algorithm — **security defect in the report**

### The problem

The published pseudocode is:

```
ALGORITHM VerifyNetwork(networkClaim, session)
  IF networkClaim.ssid IS NOT NULL AND
     networkClaim.ssid = session.authorised_ssid THEN
    RETURN { passed: TRUE }          ← returns before the IP is ever examined
  END IF
  clientSubnet <- extractSubnet(networkClaim.ipAddress)
  ...
```

`networkClaim.ssid` can only reach the server in the request body, because — as §4.8.4 and
§3.2.5 both acknowledge — a browser cannot read the Wi-Fi SSID. So the value is supplied by
the caller, and the first branch returns `passed: TRUE` on a caller-supplied string.

Campus network names are public. Anyone could send `{"ssid":"Campus_WiFi"}` from any network
in the world and satisfy FR09 outright. This defeats the report's central claim (§2.5, §5)
that all three factors must hold inside one server-side transaction: one of the three could be
passed by asserting it.

Confirmed against the built system before the fix:

```
PASS  student on campus                  {"clientIp":"192.168.1.55"}
FAIL  student off campus                 {"clientIp":"8.8.8.8"}
PASS  ATTACKER off campus, spoofs SSID   {"ssid":"Campus_WiFi","clientIp":"8.8.8.8"}
```

### Replacement pseudocode

```
ALGORITHM VerifyNetwork(request, session)
  // The source IP is the peer address of the TCP connection. It is the only network
  // signal a browser client cannot choose, and therefore the only one usable as a
  // verification factor. Any SSID in the request body is a caller-supplied claim and
  // is NOT consulted.
  clientIp <- request.sourceAddress          // never a header, never the body
  IF ipInSubnet(clientIp, session.authorised_subnet) THEN
    RETURN { passed: TRUE }
  END IF
  RETURN { passed: FALSE, reason: "NETWORK_UNAUTHORISED" }
END ALGORITHM
```

### Replacement prose for §3.2.5 (Network Authentication)

> The third verification factor confirms that the student's device is connected to an
> authorised institutional network at submission time. This is implemented by matching the
> **source IP address of the request** against the subnet configured for the session.
>
> The Wi-Fi SSID is **not** used. Browsers do not expose it to JavaScript, so any SSID reaching
> the server would be a value the client chose to send — and since campus network names are
> public, treating a matching SSID as proof would let any caller satisfy this factor from
> anywhere. The `authorised_ssid` column is retained only as a human-readable label shown to
> the teacher.
>
> The source IP is not a cryptographic proof of location either, which is why network
> authentication is one of three required signals rather than a standalone check. It is,
> however, a signal the client cannot forge: `trust proxy` is disabled by default so that
> `X-Forwarded-For` cannot be used to override it.

---

## 2. §4.9.6 Attendance Report Generation — **defect in the report**

### The problem

```
sessions <- SELECT * FROM Sessions
     WHERE course_id = courseId
     AND start_time BETWEEN dateRangeStart AND dateRangeEnd
```

`start_time` is a `DATETIME`; the bounds are dates. SQL widens a date to midnight, so
`BETWEEN '2026-08-01' AND '2026-08-07'` ends at `2026-08-07 00:00:00` and **silently drops
every session held during the last day of the range**. A report run "up to today" omits
today's classes.

Measured on the built system: the old form returned **0 sessions** where the corrected form
returned **2**.

### Replacement

```
sessions <- SELECT * FROM Sessions
     WHERE course_id = courseId
       AND start_time >= dateRangeStart
       AND start_time <  dateRangeEnd + INTERVAL 1 DAY
```

Add after the listing: *"The upper bound is expressed as the start of the following day rather
than with BETWEEN, so that the end date is inclusive of sessions held at any time on that day."*

---

## 3. FR01 and Table 3.3 — **registration: the report specifies a privilege-escalation hole**

### The problem

Table 3.3 lists:

| Endpoint | Authorization Required | Role |
|---|---|---|
| `POST /api/v1/auth/register` | Not needed | **Student and teacher** |

An unauthenticated endpoint that can create a **teacher** account. A teacher can create courses
and sessions — including setting the geofence radius and authorised subnet the checks are
measured against. Anyone able to reach the form could grant themselves control over the
attendance data the system exists to protect.

This was verified as exploitable: an account registered with `role: teacher` **successfully
created a course**. Two accounts in the development database had already been created this way.

### What the build does instead

- `POST /auth/register` is **closed by default** (`ALLOW_PUBLIC_REGISTRATION=false`) and returns
  `403`. Where enabled, the role is pinned server-side to `student` and cannot be chosen.
- Teacher and admin accounts are created only through `POST /admin/users`, behind an admin guard.
- Students are provisioned by the administration individually or by bulk import.

### Replacement FR01

> **FR01** — The system shall allow an **administrator** to create student accounts, individually
> or by bulk import, recording the institutional student number, name and email.
>
> *Rationale:* attendance records are keyed to the institutional student number, so an account
> the institution did not issue corresponds to no student on any roster. Self-registration is
> disabled by default; where it is enabled for demonstration, the role is fixed server-side to
> `student` so that privilege level can never be selected by the caller.

### Replacement Table 3.3 rows

| Method | Endpoint | Description | Auth required | Role |
|---|---|---|---|---|
| POST | `/api/v1/admin/users` | Create a student, teacher or admin account | JWT | Administrator |
| POST | `/api/v1/admin/students/import` | Bulk-create student accounts | JWT | Administrator |
| POST | `/api/v1/auth/register` | Self-registration. **Disabled by default**; creates `student` only when enabled | None | — |

---

## 4. §3.2.6 and Figure 4.5 — Devices and QR-CODE entities

Both entities existed in the diagram but not in the schema. **Now implemented** (migrations
`010_devices`, `011_qr_codes`), with one deliberate deviation:

**The QR-CODE entity's `codeValue` attribute is not stored.** A stored code value is a live
credential; a table of them is a list of tokens that work. Verification recomputes the HMAC
from the session's `qr_secret` (§4.9.3), so no lookup is needed. The entity retains
`sessionId`, `generatedAt` and `expiresAt`, which is what gives the audit trail.

Suggested note for §3.2.6:

> The QRCode entity records issuance metadata (session, generation time, expiry) but **not** the
> code value itself. Storing issued codes would create a repository of currently-valid
> credentials for no functional gain, since verification recomputes the expected signature from
> the session secret rather than retrieving it.

Also correct in §3.2.6: FR10 is enforced by the composite `UNIQUE(session_id, student_id)` on
AttendanceRecords, exactly as Table 4.1 states. The text currently attributes it to "the
Devices/Attendance Records relationship". Devices records *which handset* a check-in came from;
it is evidence, not the constraint.

---

## 5. Table 4.1 — `authorised_ssid` should be nullable

Table 4.1 specifies `authorised_ssid VARCHAR(64) NOT NULL`. Since the SSID is no longer a
verification input (correction 1), forcing a value would mean storing a meaningless string for
every session. The column is `NULL`-able in the build, and `NULL` correctly means "no label set".

---

## 6. FR05 / §3.2.2 — QR validity is now per-session

The report fixes the window at 30 seconds. The build keeps **30 seconds as the default** but
lets the teacher choose **10–300 seconds per session**, for the same reason §4.9.4 already gives
for making the geofence radius per-session: a lecture hall and a tutorial room are not the same
problem.

Suggested FR05 wording:

> **FR05** — The system shall expire each QR code after a configurable interval (default 30
> seconds, range 10–300) and generate a replacement, the interval being set by the teacher when
> the session is created.

---

## 7. NFR10 — automated backup

Specified ("daily backup") but not implemented at the time of review. **Now implemented**:
`mysqldump --single-transaction` on boot and every 24 hours, 14-day retention, `npm run db:backup`
for a manual run. Verified to produce a restorable 88 KB dump containing the schema, the data and
the migration ledger.

---

## Requirements met without change

FR02 (student ID **or** email login), FR03, FR04, FR06, FR07, FR08, FR09, FR10, FR11, FR12,
FR13, FR14, FR15; NFR01 (verified 360–1920 px), NFR02 (**measured: 10 ms average against a
3000 ms target**), NFR03, NFR05, NFR06, NFR07, NFR08, NFR09.
