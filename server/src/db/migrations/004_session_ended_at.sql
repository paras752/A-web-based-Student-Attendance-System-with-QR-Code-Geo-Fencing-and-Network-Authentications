-- Ending a session early used to overwrite end_time with NOW(), destroying the only record
-- of when the class was *scheduled* to finish. That matters: "the session was cut short 40
-- minutes early" is exactly the kind of thing a student disputing an absence would need, and
-- after the overwrite the data cannot answer it. end_time now means the scheduled end and
-- never changes; ended_at records an early close.

ALTER TABLE sessions ADD COLUMN ended_at DATETIME NULL AFTER end_time;

-- Nothing closes a session when its scheduled end passes, so is_active drifts out of step
-- with reality. Both the API and the reports already treat "past end_time" as over, so this
-- only makes the stored flag agree with the behaviour that was already in force.
UPDATE sessions SET is_active = 0 WHERE is_active = 1 AND end_time < NOW();

-- For already-closed sessions end_time is the best available answer: either it was never
-- overwritten (ran to schedule) or it was overwritten with the moment of the early close.
UPDATE sessions SET ended_at = end_time WHERE is_active = 0 AND ended_at IS NULL;
