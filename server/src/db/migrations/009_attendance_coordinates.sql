-- FR07: "The system will record the student's device GPS location at the point where the
-- scan occurs." The ER diagram (Figure 4.5) likewise gives ATTENDANCE-RECORDS its own
-- `latitude` and `longitude` attributes, and Section 3.2.6 requires each attendance log to
-- carry "the geofence's coordinate ... rather than providing just a yes/no answer".
--
-- Only the derived distance was being stored, which satisfies FR08 (was the student inside
-- the radius?) but not FR07 (where were they?). The difference matters for the auditability
-- argument the report makes against Ishaq & Bibi (2023): a distance of 12 m cannot be
-- re-checked later, whereas the coordinates it came from can.
--
-- DECIMAL(9,6) matches the precision already used for the session's geofence centre, which
-- is ~0.1 m - far finer than consumer GPS, so nothing is lost to rounding.
ALTER TABLE attendance_records
  ADD COLUMN latitude  DECIMAL(9,6) NULL AFTER student_id,
  ADD COLUMN longitude DECIMAL(9,6) NULL AFTER latitude;

-- Existing rows genuinely have no coordinate recorded; NULL says that honestly rather than
-- inventing one.
