-- A session already knows where it is to within a few metres (geofence_lat/lng) but not what
-- that place is CALLED. "Room 402" is what a teacher and a student actually use to find each
-- other, and a schedule that cannot print it is missing the one column people read first.
--
-- Nullable: existing sessions genuinely have no room recorded, and inventing one would be
-- worse than showing nothing.
ALTER TABLE sessions ADD COLUMN room VARCHAR(40) NULL AFTER course_id;
