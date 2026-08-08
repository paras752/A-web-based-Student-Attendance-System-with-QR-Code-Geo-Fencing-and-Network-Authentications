-- The Devices entity from the ER diagram (Figure 4.5) and Section 3.2.6, which lists it as
-- one of the six entities and ties it to FR10.
--
-- It existed only as a `device_fingerprint` string repeated on every attendance row. That
-- stored the same fact but could answer no question about the device itself: how many
-- accounts have checked in from one handset, or when it was first seen. Section 3.2.6's
-- stated purpose for the entity - "the physical device (hashed device fingerprint) that
-- lastly provided attendance of the student in a certain session" - needs a row per device,
-- not a column per record.
--
-- Note on FR10: duplicate prevention is enforced by UNIQUE(session_id, student_id) on
-- attendance_records, exactly as Table 4.1 specifies. This table records WHICH device a
-- check-in came from; it is evidence, not the constraint.

CREATE TABLE devices (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  -- SHA-256 of (client IP + user agent), truncated. Never the raw values: the fingerprint
  -- only needs to be comparable, and storing the inputs would turn an attendance log into a
  -- browsing-history log.
  fingerprint  VARCHAR(128) NOT NULL UNIQUE,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

ALTER TABLE attendance_records
  ADD COLUMN device_id INT NULL AFTER device_fingerprint;

-- SET NULL, not CASCADE: pruning a device record must never delete the attendance it
-- witnessed. The record is the evidence; the device is a detail about it.
ALTER TABLE attendance_records
  ADD CONSTRAINT fk_attendance_device
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

-- Backfill from the fingerprints already recorded, so existing history joins correctly
-- rather than starting from empty.
INSERT INTO devices (fingerprint)
  SELECT DISTINCT device_fingerprint FROM attendance_records
   WHERE device_fingerprint IS NOT NULL;

UPDATE attendance_records a
   JOIN devices d ON d.fingerprint = a.device_fingerprint
    SET a.device_id = d.id
  WHERE a.device_fingerprint IS NOT NULL;
