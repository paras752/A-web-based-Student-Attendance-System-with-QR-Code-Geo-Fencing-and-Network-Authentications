-- Every check-in attempt, not just the ones that worked.
--
-- Until now a record was written only when all three factors passed, so a failure left no
-- trace at all. That threw away the most diagnostic data the system produces: a student
-- swearing they tried had nothing to point at, and a teacher watching an empty roster could
-- not tell "nobody scanned" from "twenty people scanned and the Wi-Fi rejected every one".
--
-- Kept in its own table rather than as rows in attendance_records on purpose. Reports treat
-- the existence of an attendance_records row as PRESENT; putting failures there would make
-- every failed attempt count as attendance, which is precisely backwards.

CREATE TABLE attendance_attempts (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  session_id          INT NOT NULL,
  student_id          INT NOT NULL,
  -- SUCCESS, or the reason the attempt stopped: QR_EXPIRED, QR_INVALID, SESSION_INACTIVE,
  -- GEOFENCE_MISSING_COORDINATES, GEOFENCE_OUT_OF_RANGE, NETWORK_UNAUTHORISED,
  -- DUPLICATE_SUBMISSION.
  outcome             VARCHAR(40) NOT NULL,
  -- 'skipped' is meaningful, not filler: the checks short-circuit in order, so a geofence
  -- failure means the network check never ran. Recording it as 'failed' would accuse the
  -- campus network of a fault it was never asked about.
  qr_check            ENUM('passed','failed','skipped') NOT NULL DEFAULT 'skipped',
  geofence_check      ENUM('passed','failed','skipped') NOT NULL DEFAULT 'skipped',
  network_check       ENUM('passed','failed','skipped') NOT NULL DEFAULT 'skipped',
  distance_meters     DECIMAL(10,2) NULL,
  client_ip           VARCHAR(45) NULL,
  device_fingerprint  VARCHAR(128) NULL,
  attempted_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attempt_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempt_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  -- The live view asks "what happened in this session"; the student history asks "what
  -- happened to me". One index each.
  INDEX idx_attempt_session (session_id, attempted_at),
  INDEX idx_attempt_student (student_id, attempted_at)
) ENGINE=InnoDB;
