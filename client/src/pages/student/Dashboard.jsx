import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Radio,
  ScanLine,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppShell from '../../components/AppShell';
import DashboardHeading from '../../components/DashboardHeading';

// A student staring at this page is usually waiting for their teacher to start the session.
// Without polling they would sit on "Nothing live right now" until they thought to reload,
// and the QR window can be as little as 10 seconds wide.
const LIVE_POLL_MS = 15000;

function toneFor(pct, min) {
  if (pct >= min) return 'success';
  if (pct >= min - 15) return 'warning';
  return 'error';
}

function formatWhen(value) {
  const d = new Date(value);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

function minutesLeft(endTime) {
  return Math.max(0, Math.round((new Date(endTime) - Date.now()) / 60000));
}

// The percentage bar, with the pass mark drawn on the track. Reading "62%" against a visible
// 75% line takes no arithmetic; reading it on its own takes a paragraph of explanation.
function AttendanceBar({ pct, min, large }) {
  const tone = toneFor(pct, min);
  return (
    <div className={`md-progress md-progress-marked${large ? ' md-progress-lg' : ''}`}>
      <div
        className={`md-progress-bar md-progress-bar-${tone}`}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
      <span className="md-progress-threshold" style={{ left: `${min}%` }} title={`${min}% required`} />
    </div>
  );
}

function CourseRow({ course, min }) {
  const { attendancePercentage: pct, totalSessions, attendedSessions } = course;
  return (
    <div className="md-card md-card-outlined md-card-pad">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-1">
        <div className="min-w-0">
          <h4 className="md-title-medium mb-0 text-truncate" style={{ color: 'var(--md-on-surface)' }}>
            {course.courseName}
          </h4>
          <p className="md-body-small mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
            {course.courseCode}
            {course.teacherName ? ` · ${course.teacherName}` : ''}
          </p>
        </div>
        <span className="md-headline-small flex-shrink-0" style={{ color: `var(--md-${toneFor(pct, min)})` }}>
          {totalSessions === 0 ? '—' : `${pct}%`}
        </span>
      </div>

      {totalSessions === 0 ? (
        <p className="md-body-small mb-0 mt-2" style={{ color: 'var(--md-on-surface-variant)' }}>
          No classes held yet.
        </p>
      ) : (
        <>
          <div className="mt-3 mb-2">
            <AttendanceBar pct={pct} min={min} />
          </div>
          <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
            <span className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
              {attendedSessions} of {totalSessions} attended
              {course.missedSessions > 0 && ` · ${course.missedSessions} missed`}
            </span>
            {course.atRisk ? (
              <span className="md-badge md-badge-error">
                <AlertTriangle size={12} /> Attend next {course.mustAttend}
              </span>
            ) : (
              <span className="md-badge md-badge-success">
                <CheckCircle2 size={12} /> Can miss {course.canMiss}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [activeSessions, setActiveSessions] = useState([]);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const liveTimer = useRef(null);

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [summaryRes, activeRes, historyRes] = await Promise.all([
        api.get('/attendance/summary'),
        api.get('/sessions/active'),
        api.get('/attendance/history'),
      ]);
      setSummary(summaryRes.data);
      setActiveSessions(activeRes.data.sessions);
      setHistory(historyRes.data);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only the live-session list is polled. Re-fetching the whole dashboard every 15s would
  // make the percentages and course cards flicker for data that changes a few times a term.
  const pollLive = useCallback(async () => {
    try {
      const { data } = await api.get('/sessions/active');
      setActiveSessions((prev) => {
        const changed =
          prev.length !== data.sessions.length ||
          prev.some((s, i) => s.id !== data.sessions[i]?.id);
        return changed ? data.sessions : prev;
      });
    } catch {
      /* a failed poll is not worth interrupting the page for; the next tick retries */
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    liveTimer.current = setInterval(pollLive, LIVE_POLL_MS);
    // Polling a hidden tab burns the student's battery for a screen they cannot see.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') pollLive();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(liveTimer.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pollLive]);

  if (loading) {
    return (
      <AppShell title="Dashboard">
        <div className="d-flex justify-content-center py-5">
          <div className="md-spinner" role="status" aria-label="Loading" />
        </div>
      </AppShell>
    );
  }

  const min = summary?.minimumAttendancePercent ?? 75;
  const overall = summary?.overall;
  const pct = overall?.attendancePercentage ?? 0;
  const tone = toneFor(pct, min);
  const atRiskCourses = (summary?.courses || []).filter((c) => c.atRisk);

  return (
    <AppShell title="Dashboard">
      {error && (
        <div className="md-banner md-banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <DashboardHeading
        name={summary?.student?.name || user?.name}
        details={[
          summary?.student?.program,
          summary?.student?.semester && `Semester ${summary.student.semester}`,
          summary?.student?.section && `Section ${summary.student.section}`,
        ]}
      />

      <p className="md-body-large mb-4" style={{ color: 'var(--md-on-surface-variant)' }}>
        {activeSessions.length > 0
          ? `${activeSessions.length} session${activeSessions.length > 1 ? 's are' : ' is'} live right now — check in before it ends.`
          : summary?.nextSession
            ? `Next class: ${summary.nextSession.course_name}, ${formatWhen(summary.nextSession.start_time)}.`
            : 'No live sessions at the moment.'}
      </p>

      {/* Live sessions come first and only exist when they matter - a permanent "nothing
          live" placeholder trained the eye to skip the one region that ever needs acting on. */}
      {activeSessions.length > 0 && (
        <div className="mb-4">
          <div className="d-flex align-items-center gap-2 mb-3">
            <Radio size={18} style={{ color: 'var(--md-error)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Live now
            </h3>
          </div>
          <div className="row g-3">
            {activeSessions.map((s) => (
              <div className="col-md-6 col-xl-4" key={s.id}>
                <div className="md-card md-card-elevated md-card-pad h-100 d-flex flex-column">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <span className="md-badge md-badge-error">
                      <span className="md-dot" /> Live
                    </span>
                    <span className="md-label-large" style={{ color: 'var(--md-on-surface-variant)' }}>
                      {s.course_code}
                    </span>
                  </div>
                  <h4 className="md-title-medium mb-1" style={{ color: 'var(--md-on-surface)' }}>
                    {s.course_name}
                  </h4>
                  <p className="md-body-small mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                    Ends in {minutesLeft(s.end_time)} min · {s.geofence_radius_m} m radius
                  </p>
                  <Link to="/student/scan" className="md-btn md-btn-filled md-btn-block mt-auto">
                    <ScanLine size={18} /> Check in
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row g-4">
        <div className="col-lg-7">
          <div className="md-card md-card-filled md-card-pad mb-4">
            {/* Wraps rather than compressing: on a phone the badge drops to its own line
                instead of squeezing its label onto two lines inside a fixed-height pill. */}
            <div className="d-flex justify-content-between align-items-end gap-3 mb-3 flex-wrap">
              <div>
                <span className="md-label-medium text-uppercase" style={{ color: 'var(--md-on-surface-variant)' }}>
                  Overall attendance
                </span>
                <div className="d-flex align-items-baseline gap-2 mt-1">
                  <span className="md-display-small" style={{ fontWeight: 500, color: `var(--md-${tone})` }}>
                    {overall?.totalSessions === 0 ? '—' : `${pct}%`}
                  </span>
                  <span className="md-body-medium" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {min}% required
                  </span>
                </div>
              </div>
              <span
                className={`md-badge md-badge-${overall?.meetsMinimum ? 'success' : 'error'}`}
                style={{ whiteSpace: 'nowrap' }}
              >
                {overall?.meetsMinimum ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                {overall?.meetsMinimum ? 'Meeting requirement' : 'Below requirement'}
              </span>
            </div>

            <AttendanceBar pct={pct} min={min} large />

            <p className="md-body-medium mb-0 mt-3" style={{ color: 'var(--md-on-surface-variant)' }}>
              {overall?.totalSessions === 0 ? (
                'No classes have been held yet.'
              ) : overall.meetsMinimum ? (
                <>
                  You have attended <strong>{overall.attendedSessions}</strong> of{' '}
                  <strong>{overall.totalSessions}</strong> classes. You can miss the next{' '}
                  <strong>{overall.canMiss}</strong> and still stay above {min}%.
                </>
              ) : (
                <>
                  You have attended <strong>{overall.attendedSessions}</strong> of{' '}
                  <strong>{overall.totalSessions}</strong> classes. Attend the next{' '}
                  <strong>{overall.mustAttend}</strong> in a row to get back to {min}%.
                </>
              )}
            </p>
          </div>

          {atRiskCourses.length > 0 && (
            <div className="md-banner md-banner-error" role="status">
              <AlertTriangle size={20} className="flex-shrink-0" />
              <span>
                Below {min}% in {atRiskCourses.length} course
                {atRiskCourses.length > 1 ? 's' : ''}: {atRiskCourses.map((c) => c.courseCode).join(', ')}.
              </span>
            </div>
          )}

          <div className="d-flex align-items-center gap-2 mb-3">
            <BookOpen size={18} style={{ color: 'var(--md-on-surface-variant)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Your courses
            </h3>
          </div>

          {/* No "available courses to enrol in" list any more. Enrolment decides who appears
              in the official attendance report, so it is the registrar's call - a student who
              could add themselves could enter the record of a class they are not registered
              for. Rosters are managed by an admin or the course's own teacher. */}
          {(summary?.courses || []).length === 0 ? (
            <div className="md-card md-card-outlined md-card-pad text-center">
              <p className="md-body-medium mb-1" style={{ color: 'var(--md-on-surface)' }}>
                You are not enrolled in any courses yet.
              </p>
              <p className="md-body-small mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
                Your college adds you to the courses you are registered for. Contact your
                administrator if something is missing.
              </p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-3">
              {summary.courses.map((c) => (
                <CourseRow key={c.courseId} course={c} min={min} />
              ))}
            </div>
          )}
        </div>

        <div className="col-lg-5">
          {summary?.nextSession && (
            <div className="md-card md-card-primary md-card-pad mb-4">
              <div className="d-flex align-items-center gap-2 mb-2">
                <CalendarClock size={18} />
                <span className="md-label-medium text-uppercase">Next class</span>
              </div>
              <h4 className="md-title-large mb-1">{summary.nextSession.course_name}</h4>
              <p className="md-body-medium mb-0" style={{ opacity: 0.85 }}>
                {summary.nextSession.course_code} · {formatWhen(summary.nextSession.start_time)}
              </p>
            </div>
          )}

          <div className="d-flex justify-content-between align-items-center mb-3">
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Recent check-ins
            </h3>
            <Link to="/student/history" className="md-btn md-btn-text md-btn-sm">
              View all
            </Link>
          </div>

          <div className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Course</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(history?.records || []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="md-table-empty">
                      No check-ins yet
                    </td>
                  </tr>
                )}
                {(history?.records || []).slice(0, 6).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="md-label-large">
                        {new Date(r.submitted_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                      <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                        {new Date(r.submitted_at).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>
                    <td>{r.course_name}</td>
                    <td>
                      <span className="md-badge md-badge-success">Present</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
