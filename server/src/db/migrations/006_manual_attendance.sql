-- Manual attendance, for when the three automated factors cannot run: the campus Wi-Fi drops,
-- a student's phone is flat, the camera will not focus. Without this the honest answer for a
-- student who was visibly sitting in the room is "absent", which makes the report wrong.
--
-- The point of these columns is that a manual mark must never be indistinguishable from a
-- verified scan. qr/geofence/network_check_passed have been constant 1 on every row so far,
-- because a record was only ever written when all three passed; a manual mark writes 0 to all
-- three and fills in marked_by, so the three flags finally carry information and every row
-- says how it came to exist.
--
-- ON DELETE SET NULL rather than CASCADE: if the teacher's account is later removed, the
-- attendance record must survive - it is the evidence. Losing who marked it is a smaller
-- loss than losing that it was marked.

ALTER TABLE attendance_records
  ADD COLUMN marked_by INT NULL AFTER device_fingerprint,
  ADD COLUMN mark_reason VARCHAR(200) NULL AFTER marked_by;

ALTER TABLE attendance_records
  ADD CONSTRAINT fk_attendance_marked_by
  FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE SET NULL;

-- Every existing row came from a real scan, so marked_by stays NULL for all of them and the
-- distinction is correct from the first day it exists.
