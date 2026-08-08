-- Indexes for the two lookups that currently fall back to a full table scan.

-- Every /auth/refresh and /auth/logout looks a token up by its hash, and refresh_tokens is
-- the fastest-growing table in the system (one row per login AND per rotation). Left
-- unindexed it degrades the hot path for every signed-in user.
--
-- Deliberately NOT UNIQUE: the stored value is a hash of a JWT whose payload includes `iat`
-- at one-second resolution, so two logins by the same user inside the same second produce
-- byte-identical tokens. That is harmless, but a unique index would turn it into a 500.
ALTER TABLE refresh_tokens ADD INDEX idx_refresh_token_hash (token_hash);

-- Reports and the per-course session list both filter on course_id and then order/range over
-- start_time. The single-column idx_sessions_course could only satisfy the first half; this
-- composite covers both, and its leftmost prefix makes the old index redundant.
ALTER TABLE sessions ADD INDEX idx_sessions_course_start (course_id, start_time);
ALTER TABLE sessions DROP INDEX idx_sessions_course;
