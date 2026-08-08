-- Every mutable table recorded when a row was created but never when it last changed, so a
-- profile edit, a role correction or an admin password reset left no trace in the data at
-- all. For a system whose output is an attendance record students can dispute, "when was
-- this last touched" is not optional.
--
-- Maintained by the database rather than the application so it cannot be forgotten at a
-- call site. Existing rows inherit their created_at, which is the honest answer: the only
-- change we can attest to is the insert.

ALTER TABLE users
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE students
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE teachers
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE courses
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE sessions
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
