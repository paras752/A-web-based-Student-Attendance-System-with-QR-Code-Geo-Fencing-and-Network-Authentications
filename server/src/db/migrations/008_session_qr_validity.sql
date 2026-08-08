-- How long each QR code stays valid, chosen per session by the teacher.
--
-- It was a single server-wide constant (QR_VALIDITY_WINDOW_SECONDS, 30s), which is the right
-- default but the wrong shape: the window is a trade-off only the person in the room can
-- make. A 400-seat lecture hall where the screen is far away needs longer than a 12-person
-- tutorial, and a longer window is exactly how long a photographed code remains usable by
-- someone who is not in the room.
--
-- Existing sessions inherit 30, matching the constant they were created under, so no
-- historical QR behaves differently in hindsight.
ALTER TABLE sessions
  ADD COLUMN qr_validity_seconds INT NOT NULL DEFAULT 30 AFTER qr_secret;
