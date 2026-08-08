-- Smart Student Attendance System (SSAS) schema
-- Run against MySQL 8.0 or MariaDB 10.4+ (matches Section 3.2.6 / Table 4.1 / Figure 4.5 of
-- the capstone report).
--
-- WARNING: this file is a factory reset - it DROPs every table before recreating it. It is
-- only ever run by `npm run db:init`, which now refuses to touch a database that already has
-- data. To change the schema of a database that is in use, add a file under ./migrations and
-- run `npm run db:migrate`; this file must then be updated to match, so that a fresh install
-- and a migrated install end up identical.

-- This file contains NO `CREATE DATABASE` / `USE` statement, deliberately. It used to
-- hardcode `USE ssas`, which meant DB_NAME was silently ignored: pointing the tool at a
-- scratch database still dropped every table in the real one. init.js now creates and
-- selects the database named by DB_NAME before running this, so the two can never disagree.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS attendance_attempts;
DROP TABLE IF EXISTS qr_codes;
DROP TABLE IF EXISTS attendance_records;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS teachers;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(190)  NOT NULL UNIQUE,
  password_hash VARCHAR(100)  NOT NULL,
  role          ENUM('student', 'teacher', 'admin') NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE students (
  user_id         INT PRIMARY KEY,
  student_number  VARCHAR(40) NOT NULL UNIQUE,
  program         VARCHAR(100),
  semester        VARCHAR(20),
  section         VARCHAR(20),
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE teachers (
  user_id      INT PRIMARY KEY,
  department   VARCHAR(100),
  designation  VARCHAR(100),
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- teacher_id references teachers(user_id), not users(id): "a course is owned by a teacher"
-- is an invariant the database can enforce on its own, and that is what the teachers table
-- is for. See migrations/002_course_teacher_fk.sql.
CREATE TABLE courses (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  course_name   VARCHAR(150) NOT NULL,
  course_code   VARCHAR(30)  NOT NULL UNIQUE,
  teacher_id    INT NULL,
  credit_hours  INT NOT NULL DEFAULT 3,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_courses_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE enrolments (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  student_id      INT NOT NULL,
  course_id       INT NOT NULL,
  enrolment_date  DATE NOT NULL DEFAULT (CURRENT_DATE),
  CONSTRAINT fk_enrolments_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_enrolments_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE KEY uq_enrolment (student_id, course_id)
) ENGINE=InnoDB;

CREATE TABLE sessions (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  course_id          INT NOT NULL,
  -- Human-readable location ("Room 402"). The geofence says where the room is; this says
  -- what people call it.
  room               VARCHAR(40) NULL,
  qr_secret          VARCHAR(128) NOT NULL,
  -- Per-session, because the trade-off (reachable code vs. a photograph staying usable)
  -- depends on the room. Defaults to the 30s the system was built around.
  qr_validity_seconds INT NOT NULL DEFAULT 30,
  geofence_lat       DECIMAL(9,6) NOT NULL,
  geofence_lng       DECIMAL(9,6) NOT NULL,
  geofence_radius_m  INT NOT NULL DEFAULT 50,
  authorised_ssid    VARCHAR(64) NULL,
  authorised_subnet  VARCHAR(64) NOT NULL,
  start_time         DATETIME NOT NULL,
  -- Scheduled end. Never overwritten: closing a session early sets ended_at instead, so the
  -- record still shows what the class was meant to run until.
  end_time           DATETIME NOT NULL,
  ended_at           DATETIME NULL,
  is_active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  -- Reports filter by course and then range over start_time; the composite serves both, and
  -- its leftmost prefix covers plain course_id lookups too.
  INDEX idx_sessions_course_start (course_id, start_time)
) ENGINE=InnoDB;

-- Devices entity (ER Figure 4.5 / Section 3.2.6): the handset a check-in came from. Stores
-- only a hash of (IP + user agent) - comparable, but not a browsing record.
CREATE TABLE devices (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  fingerprint   VARCHAR(128) NOT NULL UNIQUE,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- A row exists either because a student passed all three checks (the three flags are 1 and
-- marked_by is NULL) or because a teacher marked them present when the checks could not run
-- (the flags are 0 and marked_by names the teacher). Those two must always be tellable apart.
CREATE TABLE attendance_records (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  session_id             INT NOT NULL,
  student_id             INT NOT NULL,
  -- FR07 / ER Figure 4.5: the position the scan was made from, not just the distance derived
  -- from it. A stored distance cannot be re-checked later; the coordinates can.
  latitude               DECIMAL(9,6) NULL,
  longitude              DECIMAL(9,6) NULL,
  qr_check_passed        TINYINT(1) NOT NULL,
  geofence_check_passed  TINYINT(1) NOT NULL,
  network_check_passed   TINYINT(1) NOT NULL,
  distance_meters        DECIMAL(10,2) NULL,
  device_fingerprint     VARCHAR(128) NULL,
  device_id              INT NULL,
  marked_by              INT NULL,
  mark_reason            VARCHAR(200) NULL,
  submitted_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: the record is evidence and must outlive the marker's account.
  CONSTRAINT fk_attendance_marked_by FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE SET NULL,
  -- Likewise: pruning a device must never delete the attendance it witnessed.
  CONSTRAINT fk_attendance_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
  UNIQUE KEY uq_session_student (session_id, student_id),
  INDEX idx_attendance_student (student_id)
) ENGINE=InnoDB;

-- QR-CODE entity (ER Figure 4.5): one row per code issued. `codeValue` from the diagram is
-- deliberately NOT stored - a table of live credentials is a liability, and verification
-- recomputes the HMAC from the session secret rather than looking a value up.
CREATE TABLE qr_codes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  session_id   INT NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  CONSTRAINT fk_qr_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  INDEX idx_qr_session (session_id, generated_at)
) ENGINE=InnoDB;

-- Every check-in attempt, successful or not. Separate from attendance_records because
-- reports read the existence of an attendance_records row as PRESENT - a failed attempt
-- stored there would count as attendance. See migrations/007_attendance_attempts.sql.
CREATE TABLE attendance_attempts (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  session_id          INT NOT NULL,
  student_id          INT NOT NULL,
  outcome             VARCHAR(40) NOT NULL,
  -- 'skipped' records that a check never ran, because the three short-circuit in order.
  qr_check            ENUM('passed','failed','skipped') NOT NULL DEFAULT 'skipped',
  geofence_check      ENUM('passed','failed','skipped') NOT NULL DEFAULT 'skipped',
  network_check       ENUM('passed','failed','skipped') NOT NULL DEFAULT 'skipped',
  distance_meters     DECIMAL(10,2) NULL,
  client_ip           VARCHAR(45) NULL,
  device_fingerprint  VARCHAR(128) NULL,
  attempted_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attempt_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempt_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_attempt_session (session_id, attempted_at),
  INDEX idx_attempt_student (student_id, attempted_at)
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  token_hash  VARCHAR(128) NOT NULL,
  expires_at  DATETIME NOT NULL,
  revoked_at  DATETIME NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_refresh_user (user_id),
  -- Every refresh and logout looks a row up by hash. Not UNIQUE: the hashed JWT carries
  -- `iat` at one-second resolution, so two logins in the same second are byte-identical.
  INDEX idx_refresh_token_hash (token_hash)
) ENGINE=InnoDB;

-- Applied-migration ledger. Created here so a fresh install starts with the table already
-- present; db:init then records every existing migration as applied.
CREATE TABLE schema_migrations (
  version     VARCHAR(255) NOT NULL PRIMARY KEY,
  checksum    CHAR(64)     NOT NULL,
  applied_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
