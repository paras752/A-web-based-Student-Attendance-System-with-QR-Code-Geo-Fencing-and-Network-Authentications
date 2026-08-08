import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Circle, Hand, StopCircle, Undo2 } from 'lucide-react';
import api from '../../api/client';
import AppShell from '../../components/AppShell';

const ROSTER_POLL_MS = 4000;

// Each failure reason turned into something a teacher can act on, rather than the raw code.
// The hint says what to DO, because the useful response to most of these is manual marking.
const FAILURE_MEANING = {
  QR_EXPIRED: {
    label: 'QR code had expired',
    hint: 'They scanned an old code — codes last 30 seconds. Ask them to scan the current one.',
  },
  QR_INVALID: {
    label: 'QR code not valid',
    hint: 'Scanned a code from a different session, or a photo of one.',
  },
  SESSION_INACTIVE: {
    label: 'Session was not running',
    hint: 'They scanned before it started or after it ended.',
  },
  GEOFENCE_MISSING_COORDINATES: {
    label: 'No location from their device',
    hint: 'Location permission denied or GPS unavailable indoors. Mark them present if they are in the room.',
  },
  GEOFENCE_OUT_OF_RANGE: {
    label: 'Outside the classroom area',
    hint: 'Beyond the radius you set. If the radius is too tight for this room, widen it next time.',
  },
  NETWORK_UNAUTHORISED: {
    label: 'Not on the authorised network',
    hint: 'Campus Wi-Fi is down or they are on mobile data. Mark them present if they are here.',
  },
};

export default function LiveSession() {
  const { sessionId } = useParams();
  const [qrImage, setQrImage] = useState(null);
  const [validitySeconds, setValiditySeconds] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ending, setEnding] = useState(false);
  const [markTarget, setMarkTarget] = useState(null);
  const [markReason, setMarkReason] = useState('');
  const [busyStudent, setBusyStudent] = useState(null);
  const qrIntervalRef = useRef(null);
  const rosterIntervalRef = useRef(null);

  const fetchQr = useCallback(async () => {
    try {
      const { data } = await api.get(`/sessions/${sessionId}/qr`);
      setQrImage(data.qr.imageDataUrl);
      // The window comes from the server, not a constant here, so the code on screen is
      // replaced exactly as often as the server will still accept it.
      setValiditySeconds(data.qr.validitySeconds || 30);
      setExpiresAt(data.qr.expiresAt);
    } catch (err) {
      // 409 means the session is over. That is not an error the teacher needs shouting at
      // them - the page below already says so plainly.
      if (err.response?.status === 409) {
        setQrImage(null);
        return;
      }
      setError(err.response?.data?.error?.message || 'Failed to refresh QR code');
    }
  }, [sessionId]);

  const fetchRoster = useCallback(async () => {
    try {
      const { data } = await api.get(`/sessions/${sessionId}/live`);
      setRoster(data);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load live attendance');
    }
  }, [sessionId]);

  // Whether the class is over, derived from the session the roster endpoint returns rather
  // than assumed. `ended_at` is set when a teacher closes it early; end_time covers one that
  // simply ran out.
  const session = roster?.session;
  // Recomputed when the roster poll brings a fresh session (every few seconds), which is the
  // right cadence for noticing a class that has just run past its end time - and stable
  // between polls, so the QR interval below is not rebuilt on every render.
  const hasEnded = useMemo(
    () =>
      session
        ? !session.is_active || Boolean(session.ended_at) || new Date(session.end_time) < new Date()
        : false,
    [session]
  );

  useEffect(() => {
    fetchRoster();
    rosterIntervalRef.current = setInterval(fetchRoster, ROSTER_POLL_MS);
    return () => clearInterval(rosterIntervalRef.current);
  }, [fetchRoster]);

  // The QR is fetched only while the session is actually running. Polling it for a finished
  // class was what kept a scannable-looking code on screen after "End session".
  //
  // Depends on session.id and hasEnded - both primitives - never on the session object. The
  // roster poll replaces that object every 4 seconds, so an object dependency would tear
  // down and recreate this interval before the 30-second timer ever fired: the QR would sit
  // unchanged on screen while appearing to rotate, quietly widening the window in which a
  // photographed code stays valid.
  const sessionId_ = session?.id;
  useEffect(() => {
    if (!sessionId_ || hasEnded) {
      clearInterval(qrIntervalRef.current);
      setQrImage(null);
      return undefined;
    }
    fetchQr();
    return () => clearInterval(qrIntervalRef.current);
  }, [sessionId_, hasEnded, fetchQr]);

  // Rescheduled whenever the window changes, rather than pinned to a constant, so a session
  // configured for 60s rolls its code every 60s and one set to 15s every 15s.
  useEffect(() => {
    clearInterval(qrIntervalRef.current);
    if (!validitySeconds || hasEnded || !sessionId_) return undefined;
    qrIntervalRef.current = setInterval(fetchQr, validitySeconds * 1000);
    return () => clearInterval(qrIntervalRef.current);
  }, [validitySeconds, hasEnded, sessionId_, fetchQr]);

  // Ticking countdown so the teacher can see the code is alive and how long students have.
  useEffect(() => {
    if (!expiresAt || hasEnded) {
      setSecondsLeft(null);
      return undefined;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt, hasEnded]);

  const handleMark = async (e) => {
    e.preventDefault();
    setBusyStudent(markTarget.student_id);
    setError('');
    setNotice('');
    try {
      await api.post(`/sessions/${sessionId}/attendance`, {
        studentId: markTarget.student_id,
        reason: markReason || undefined,
      });
      setNotice(`${markTarget.name} marked present manually.`);
      setMarkTarget(null);
      setMarkReason('');
      await fetchRoster();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Could not mark that student present');
    } finally {
      setBusyStudent(null);
    }
  };

  const handleUnmark = async (row) => {
    if (!window.confirm(`Remove the manual attendance mark for ${row.name}?`)) return;
    setBusyStudent(row.student_id);
    setError('');
    setNotice('');
    try {
      await api.delete(`/sessions/${sessionId}/attendance/${row.student_id}`);
      setNotice(`Manual mark removed for ${row.name}.`);
      await fetchRoster();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Could not remove that mark');
    } finally {
      setBusyStudent(null);
    }
  };

  // Stays on the page rather than navigating away: the register is often corrected right
  // after the class, and bouncing to the dashboard hid the one screen where that is done.
  const handleEnd = async () => {
    if (!window.confirm('End this session? Students will no longer be able to scan, but you can still correct the register here.')) return;
    setEnding(true);
    setError('');
    try {
      await api.patch(`/sessions/${sessionId}/end`);
      setNotice('Session ended. You can still mark anyone who could not scan.');
      await fetchRoster();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to end session');
    } finally {
      setEnding(false);
    }
  };

  const pct = roster && roster.totalCount > 0 ? Math.round((roster.presentCount / roster.totalCount) * 100) : 0;

  return (
    <AppShell title="Live session">
      {error && (
        <div className="md-banner md-banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="md-banner md-banner-success" role="status">
          <span>{notice}</span>
        </div>
      )}

      {markTarget && (
        <div className="md-card md-card-elevated md-card-pad mb-4">
          <div className="d-flex align-items-center gap-2 mb-2">
            <Hand size={20} style={{ color: 'var(--md-primary)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Mark {markTarget.name} present
            </h3>
          </div>
          {/* Saying plainly what this does to the record, at the moment of doing it. */}
          <div className="md-banner md-banner-warning">
            <span>
              This records attendance <strong>without</strong> the QR, location and network
              checks. It will be stored as a manual mark in your name and shown as such on
              every report — it does not pretend to be a verified scan.
            </span>
          </div>
          <form onSubmit={handleMark}>
            <div className="md-field">
              <label className="md-field-label" htmlFor="mark-reason">Reason (optional)</label>
              <input
                id="mark-reason"
                className="md-input"
                maxLength={200}
                autoFocus
                placeholder="e.g. campus Wi-Fi down, phone battery flat"
                value={markReason}
                onChange={(e) => setMarkReason(e.target.value)}
              />
              <span className="md-supporting">
                Worth filling in — it is what explains the override if the record is queried later.
              </span>
            </div>
            <div className="d-flex gap-2">
              <button className="md-btn md-btn-filled" type="submit" disabled={busyStudent === markTarget.student_id}>
                {busyStudent === markTarget.student_id ? 'Marking…' : 'Mark present'}
              </button>
              <button type="button" className="md-btn md-btn-text" onClick={() => setMarkTarget(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="row g-4">
        <div className="col-lg-5">
          <div className="md-card md-card-elevated md-card-pad text-center">
            {hasEnded ? (
              <>
                {/* An ended session shows that it ended. Previously it kept rendering a fresh
                    QR and an End button, so a finished class was indistinguishable from a
                    running one. */}
                <div
                  className="mx-auto d-flex flex-column align-items-center justify-content-center mb-4"
                  style={{
                    width: '100%',
                    maxWidth: 320,
                    aspectRatio: '1 / 1',
                    borderRadius: 'var(--md-shape-xl)',
                    background: 'var(--md-surface-container-highest)',
                    color: 'var(--md-on-surface-variant)',
                    padding: 24,
                  }}
                >
                  <CheckCircle2 size={48} className="mb-3" style={{ color: 'var(--md-success)' }} />
                  <h3 className="md-title-large mb-2" style={{ color: 'var(--md-on-surface)' }}>
                    Session ended
                  </h3>
                  <p className="md-body-small mb-0">
                    {session?.ended_at
                      ? `Closed at ${new Date(session.ended_at).toLocaleTimeString()}`
                      : `Finished at ${new Date(session?.end_time).toLocaleTimeString()}`}
                  </p>
                  <p className="md-body-small mb-0 mt-2">No QR code is issued for a finished class.</p>
                </div>

                <Link to="/teacher/sessions" className="md-btn md-btn-outlined md-btn-block">
                  Back to sessions
                </Link>
              </>
            ) : (
              <>
                <h3 className="md-title-large mb-1" style={{ color: 'var(--md-on-surface)' }}>
                  Show this to the class
                </h3>
                <p className="md-body-small mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                  {validitySeconds
                    ? `Replaces itself every ${validitySeconds} seconds`
                    : 'Loading…'}
                </p>

                {/* A visible countdown, so it is obvious the code is live and how long a
                    student has to scan it. */}
                {secondsLeft !== null && (
                  <div className="mb-3">
                    <div className="md-progress" aria-hidden="true">
                      <div
                        className={`md-progress-bar ${secondsLeft <= 5 ? 'md-progress-bar-warning' : ''}`}
                        style={{
                          width: `${validitySeconds ? (secondsLeft / validitySeconds) * 100 : 0}%`,
                          transition: 'width 1s linear',
                        }}
                      />
                    </div>
                    <p className="md-label-large mb-0 mt-2" style={{ color: 'var(--md-on-surface-variant)' }}>
                      Expires in {secondsLeft}s
                    </p>
                  </div>
                )}

                <div
                  className="mx-auto d-flex align-items-center justify-content-center overflow-hidden mb-4"
                  style={{
                    width: '100%',
                    maxWidth: 320,
                    aspectRatio: '1 / 1',
                    borderRadius: 'var(--md-shape-xl)',
                    background: '#ffffff',
                    padding: 16,
                  }}
                >
                  {qrImage ? (
                    <img
                      src={qrImage}
                      alt="Attendance QR code"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <div className="md-spinner" role="status" aria-label="Loading QR code" />
                  )}
                </div>

                <button type="button" className="md-btn md-btn-danger md-btn-block" onClick={handleEnd} disabled={ending}>
                  <StopCircle size={18} /> {ending ? 'Ending…' : 'End session'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="col-lg-7">
          <div className="md-card md-card-filled md-card-pad mb-3">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
                {hasEnded ? 'Final attendance' : 'Live attendance'}
              </h3>
              {roster && (
                <span className="md-headline-small" style={{ color: 'var(--md-primary)' }}>
                  {roster.presentCount}/{roster.totalCount}
                </span>
              )}
            </div>
            <div className="md-progress">
              <div className="md-progress-bar" style={{ width: `${pct}%` }} />
            </div>
            {roster?.manualCount > 0 && (
              <p className="md-body-small mb-0 mt-2" style={{ color: 'var(--md-on-surface-variant)' }}>
                {roster.manualCount} of these {roster.manualCount === 1 ? 'was' : 'were'} marked
                manually, not verified by scan.
              </p>
            )}
            {/* Saying the override exists, rather than leaving a button in a table column to
                be discovered. It stays available after the class ends, because a broken
                connection is usually noticed afterwards. */}
            {roster && roster.presentCount < roster.totalCount && (
              <p className="md-body-small mb-0 mt-2" style={{ color: 'var(--md-on-surface-variant)' }}>
                Couldn't a student scan? Use <strong>Mark present</strong> beside their name
                {hasEnded ? ' — the register can still be corrected now the class has ended.' : '.'}
              </p>
            )}
          </div>

          {/* An empty roster used to be a mystery. These are the attempts that were made and
              rejected, so the teacher can tell "nobody scanned" from "everybody scanned and
              the network refused them". */}
          {roster?.failures?.length > 0 && (
            <div className="md-card md-card-outlined md-card-pad mb-3">
              <div className="d-flex align-items-center gap-2 mb-2">
                <AlertTriangle size={18} style={{ color: 'var(--md-warning)' }} />
                <h4 className="md-title-medium mb-0" style={{ color: 'var(--md-on-surface)' }}>
                  Failed check-in attempts
                </h4>
              </div>
              <div className="d-flex flex-column gap-2">
                {roster.failures.map((f) => {
                  const meta = FAILURE_MEANING[f.outcome] || {
                    label: f.outcome,
                    hint: 'Attempt rejected.',
                  };
                  return (
                    <div key={f.outcome} className="d-flex justify-content-between align-items-start gap-3">
                      <div>
                        <div className="md-title-small" style={{ color: 'var(--md-on-surface)' }}>
                          {meta.label}
                        </div>
                        <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {meta.hint}
                          {f.outcome === 'GEOFENCE_OUT_OF_RANGE' && f.worstDistance !== null
                            ? ` Furthest was ${Math.round(f.worstDistance)} m away.`
                            : ''}
                        </div>
                      </div>
                      <span className="md-badge md-badge-warning flex-shrink-0">
                        {f.students} student{f.students === 1 ? '' : 's'} · {f.attempts} tr{f.attempts === 1 ? 'y' : 'ies'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="md-table-wrap">
            <div className="md-scroll-x">
              <table className="md-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Checked in</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {!roster && (
                    <tr>
                      <td colSpan={5} className="md-table-empty">
                        Loading roster…
                      </td>
                    </tr>
                  )}
                  {roster?.roster.length === 0 && (
                    <tr>
                      <td colSpan={5} className="md-table-empty">
                        No students enrolled in this course yet.
                      </td>
                    </tr>
                  )}
                  {roster?.roster.map((r) => (
                    <tr key={r.student_id}>
                      <td className="md-title-small">{r.name}</td>
                      <td style={{ color: 'var(--md-on-surface-variant)' }}>{r.student_number}</td>
                      <td>
                        {/* Three distinct states, never two. A manual mark reads differently
                            from a verified scan everywhere it appears. */}
                        {r.method === 'verified' ? (
                          <span className="md-badge md-badge-success">
                            <CheckCircle2 size={12} /> Present
                          </span>
                        ) : r.method === 'manual' ? (
                          <span className="md-badge md-badge-warning" title={r.mark_reason || 'Marked by teacher'}>
                            <Hand size={12} /> Manual
                          </span>
                        ) : (
                          <span className="md-badge md-badge-neutral">
                            <Circle size={12} /> Awaiting
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--md-on-surface-variant)' }}>
                        {r.submitted_at ? (
                          <>
                            <div>{new Date(r.submitted_at).toLocaleTimeString()}</div>
                            {r.method === 'manual' && (
                              <div className="md-body-small">
                                by {r.marked_by_name || 'teacher'}
                                {r.mark_reason ? ` · ${r.mark_reason}` : ''}
                              </div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {r.method === null && (
                          <button
                            type="button"
                            className="md-btn md-btn-outlined md-btn-sm"
                            disabled={busyStudent === r.student_id}
                            onClick={() => {
                              setMarkTarget(r);
                              setMarkReason('');
                              setError('');
                              setNotice('');
                            }}
                          >
                            <Hand size={14} /> Mark present
                          </button>
                        )}
                        {r.method === 'manual' && (
                          <button
                            type="button"
                            className="md-btn md-btn-text md-btn-sm"
                            disabled={busyStudent === r.student_id}
                            onClick={() => handleUnmark(r)}
                          >
                            <Undo2 size={14} /> Undo
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
