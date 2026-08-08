-- The QR-CODE entity from the ER diagram (Figure 4.5): one row per code issued for a
-- session, with generatedAt and expiresAt.
--
-- ONE DELIBERATE OMISSION: the diagram gives the entity a `codeValue`, and that column is
-- not created here. A stored code value is a stored credential - a table of them would be a
-- list of tokens that were valid, and anyone who could read it during a code's lifetime
-- could submit attendance with it. Nothing needs the value: verification recomputes the
-- HMAC from the session's qr_secret (Section 4.9.3), so the code is derived on demand and
-- never has to be looked up.
--
-- What this table adds is the audit trail the entity implies - how many codes a session
-- issued and over what window - which is the part that could not be answered before.

CREATE TABLE qr_codes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  session_id   INT NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  CONSTRAINT fk_qr_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  INDEX idx_qr_session (session_id, generated_at)
) ENGINE=InnoDB;
