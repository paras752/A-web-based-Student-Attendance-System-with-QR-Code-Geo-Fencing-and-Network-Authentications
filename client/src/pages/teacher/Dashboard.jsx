import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  MapPin,
  Plus,
  Radio,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppShell from '../../components/AppShell';
import DashboardHeading from '../../components/DashboardHeading';

// The dashboard is the screen a teacher leaves open during a class, so a session that starts
// or a student who checks in has to appear without a reload.
const POLL_MS = 20000;

const timeOf = (v) =>
  new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const dayOf = (v) =>
  new Date(v).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function StatCard({ label, children, tone }) {
  return (
    <div className={`md-card ${tone === 'primary' ? 'md-card-primary' : 'md-card-filled'} md-card-pad h-100`}>
      <div
        className="md-label-medium text-uppercase mb-2"
        style={{ color: tone === 'primary' ? 'inherit' : 'var(--md-on-surface-variant)', opacity: tone === 'primary' ? 0.9 : 1 }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const STATUS_BADGE = {
  live: { cls: 'md-badge-error', label: 'Live' },
  scheduled: { cls: 'md-badge-neutral', label: 'Scheduled' },
  completed: { cls: 'md-badge-success', label: 'Completed' },
};

export default function TeacherDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const load = useCallback(async (quiet) => {
    if (!quiet) setError('');
    try {
      const [overviewRes, coursesRes] = await Promise.all([
        api.get('/sessions/overview'),
        api.get('/courses'),
      ]);
      setData(overviewRes.data);
      setCourses(coursesRes.data.courses);
    } catch (err) {
      // A failed background refresh keeps the last good screen rather than replacing a
      // working dashboard with an error the teacher did not cause.
      if (!quiet) setError(err.response?.data?.error?.message || 'Failed to load your dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    timer.current = setInterval(() => load(true), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && load(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  if (loading) {
    return (
      <AppShell title="Dashboard">
        <div className="d-flex justify-content-center py-5">
          <div className="md-spinner" role="status" aria-label="Loading" />
        </div>
      </AppShell>
    );
  }

  const live = data?.live?.[0] || null;
  const week = data?.weeklyAttendance;
  const delta = week?.current !== null && week?.previous !== null ? week.current - week.previous : null;
  const newSessionHref = courses[0] ? `/teacher/courses/${courses[0].id}/session/new` : null;

  return (
    <AppShell title="Dashboard">
      {error && (
        <div className="md-banner md-banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <DashboardHeading
        name={data?.teacher?.name || user?.name}
        details={[data?.teacher?.department, data?.teacher?.designation]}
      >
        {newSessionHref && (
          <Link to={newSessionHref} className="md-btn md-btn-filled">
            <Plus size={18} /> New session
          </Link>
        )}
      </DashboardHeading>

      <div className="row g-3 mb-4">
        <div className="col-md-6 col-xl-3">
          <StatCard label="Active session" tone={live ? 'primary' : undefined}>
            {live ? (
              <>
                <div className="md-title-large mb-1">{live.course_name}</div>
                <div className="md-body-small mb-2" style={{ opacity: 0.85 }}>
                  {live.course_code}
                  {live.room ? ` · ${live.room}` : ''}
                </div>
                <div className="d-flex align-items-center gap-2 md-label-large">
                  <span className="md-dot" /> LIVE NOW · {live.present}/{live.enrolled} in
                </div>
                <Link
                  to={`/teacher/session/${live.id}/live`}
                  className="md-btn md-btn-filled md-btn-sm mt-3"
                >
                  View live <ArrowRight size={15} />
                </Link>
              </>
            ) : (
              <>
                <div className="md-headline-small mb-1" style={{ color: 'var(--md-on-surface)' }}>
                  None
                </div>
                <p className="md-body-small mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
                  Nothing is running right now.
                </p>
              </>
            )}
          </StatCard>
        </div>

        <div className="col-md-6 col-xl-3">
          <StatCard label="Today's classes">
            <div className="d-flex align-items-baseline gap-2">
              <span className="md-display-small" style={{ fontWeight: 500, color: 'var(--md-on-surface)' }}>
                {data.todayRemaining}
              </span>
              <span className="md-body-medium" style={{ color: 'var(--md-on-surface-variant)' }}>
                remaining
              </span>
            </div>
            <div className="md-progress mt-3">
              <div
                className="md-progress-bar"
                style={{ width: data.today.length ? `${(data.todayCompleted / data.today.length) * 100}%` : '0%' }}
              />
            </div>
            <p className="md-body-small mb-0 mt-2" style={{ color: 'var(--md-on-surface-variant)' }}>
              {data.todayCompleted} of {data.today.length} completed
            </p>
          </StatCard>
        </div>

        <div className="col-md-6 col-xl-3">
          <StatCard label="Total students">
            <div className="md-display-small" style={{ fontWeight: 500, color: 'var(--md-on-surface)' }}>
              {data.totals.totalStudents}
            </div>
            <p className="md-body-small mb-0 mt-2" style={{ color: 'var(--md-on-surface-variant)' }}>
              across {data.totals.totalCourses} course{data.totals.totalCourses === 1 ? '' : 's'}
            </p>
          </StatCard>
        </div>

        <div className="col-md-6 col-xl-3">
          <StatCard label="Avg. attendance this week">
            {week.current === null ? (
              <>
                <div className="md-display-small" style={{ fontWeight: 500, color: 'var(--md-on-surface-variant)' }}>
                  —
                </div>
                {/* Not 0%: no classes held and nobody attending are different facts. */}
                <p className="md-body-small mb-0 mt-2" style={{ color: 'var(--md-on-surface-variant)' }}>
                  No sessions held this week
                </p>
              </>
            ) : (
              <>
                <div className="md-display-small" style={{ fontWeight: 500, color: 'var(--md-on-surface)' }}>
                  {week.current}%
                </div>
                <p
                  className="md-body-small mb-0 mt-2 d-flex align-items-center gap-1"
                  style={{ color: delta === null ? 'var(--md-on-surface-variant)' : delta >= 0 ? 'var(--md-success)' : 'var(--md-error)' }}
                >
                  {delta === null ? (
                    <span style={{ color: 'var(--md-on-surface-variant)' }}>
                      over {week.sessionsHeld} session{week.sessionsHeld === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <>
                      {delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                      {delta >= 0 ? '+' : ''}
                      {Math.round(delta * 10) / 10}% from last week
                    </>
                  )}
                </p>
              </>
            )}
          </StatCard>
        </div>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
          Today's schedule
        </h3>
        <Link to="/teacher/reports" className="md-btn md-btn-text md-btn-sm">
          Reports <ArrowRight size={15} />
        </Link>
      </div>

      <div className="md-table-wrap mb-4">
        <div className="md-scroll-x">
          <table className="md-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Course</th>
                <th>Room</th>
                <th>Students</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.today.length === 0 && (
                <tr>
                  <td colSpan={6} className="md-table-empty">
                    No sessions scheduled for today.
                  </td>
                </tr>
              )}
              {data.today.map((s) => {
                const badge = STATUS_BADGE[s.status];
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="md-label-large" style={{ color: 'var(--md-on-surface)' }}>
                        {timeOf(s.start_time)}
                      </div>
                      <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                        {timeOf(s.ended_at || s.end_time)}
                      </div>
                    </td>
                    <td>
                      <div className="md-title-small">{s.course_code}</div>
                      <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                        {s.course_name}
                      </div>
                    </td>
                    <td>
                      {s.room ? (
                        <span className="md-chip">
                          <MapPin size={13} /> {s.room}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--md-on-surface-variant)' }}>—</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--md-on-surface-variant)' }}>
                      {s.present}/{s.enrolled}
                    </td>
                    <td>
                      <span className={`md-badge ${badge.cls}`}>
                        {s.status === 'live' && <span className="md-dot" />} {badge.label}
                      </span>
                    </td>
                    <td>
                      {s.status === 'completed' ? (
                        <Link to={`/teacher/session/${s.id}/live`} className="md-btn md-btn-text md-btn-sm">
                          View
                        </Link>
                      ) : (
                        <Link
                          to={`/teacher/session/${s.id}/live`}
                          className={`md-btn md-btn-sm ${s.status === 'live' ? 'md-btn-filled' : 'md-btn-outlined'}`}
                        >
                          {s.status === 'live' ? 'View live' : 'Open'}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-7">
          <div className="d-flex align-items-center gap-2 mb-3">
            <AlertTriangle size={18} style={{ color: 'var(--md-on-surface-variant)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Students below {data.minimumAttendancePercent}%
            </h3>
          </div>

          {/* The actionable half of the dashboard. A headline percentage says something is
              wrong; this says who to talk to. */}
          {data.atRisk.length === 0 ? (
            <div className="md-card md-card-outlined md-card-pad text-center">
              <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
                Nobody is below the attendance requirement.
              </p>
            </div>
          ) : (
            <div className="md-table-wrap">
              <div className="md-scroll-x">
                <table className="md-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Course</th>
                      <th>Attended</th>
                      <th>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.atRisk.map((r) => (
                      <tr key={`${r.studentId}-${r.courseId}`}>
                        <td>
                          <div className="md-title-small">{r.name}</div>
                          <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                            {r.studentNumber}
                          </div>
                        </td>
                        <td style={{ color: 'var(--md-on-surface-variant)' }}>{r.courseCode}</td>
                        <td style={{ color: 'var(--md-on-surface-variant)' }}>
                          {r.attended}/{r.totalSessions}
                          <span className="md-body-small"> · {r.missed} missed</span>
                        </td>
                        <td>
                          <span className="md-badge md-badge-error">{r.attendancePercentage}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="col-lg-5">
          <div className="d-flex align-items-center gap-2 mb-3">
            <CalendarClock size={18} style={{ color: 'var(--md-on-surface-variant)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Coming up
            </h3>
          </div>

          {data.upcoming.length === 0 ? (
            <div className="md-card md-card-outlined md-card-pad text-center mb-4">
              <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
                Nothing scheduled beyond today.
              </p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-2 mb-4">
              {data.upcoming.map((s) => (
                <div key={s.id} className="md-card md-card-outlined md-card-pad">
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div>
                      <div className="md-title-small">{s.course_code}</div>
                      <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                        {dayOf(s.start_time)} · {timeOf(s.start_time)}
                        {s.room ? ` · ${s.room}` : ''}
                      </div>
                    </div>
                    <span className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                      {s.enrolled} enrolled
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="d-flex align-items-center gap-2 mb-3">
            <BookOpen size={18} style={{ color: 'var(--md-on-surface-variant)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              My courses
            </h3>
          </div>
          <div className="d-flex flex-column gap-2">
            {courses.length === 0 && (
              <div className="md-card md-card-outlined md-card-pad text-center">
                <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
                  You do not own any courses yet. An admin assigns them.
                </p>
              </div>
            )}
            {courses.map((c) => (
              <div key={c.id} className="md-card md-card-outlined md-card-pad d-flex justify-content-between align-items-center gap-3">
                <div className="min-w-0">
                  <div className="md-title-small text-truncate">{c.course_name}</div>
                  <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {c.course_code} · {c.credit_hours} credits
                  </div>
                </div>
                <div className="d-flex gap-2 flex-shrink-0">
                  <Link to={`/teacher/courses/${c.id}/session/new`} className="md-btn md-btn-filled md-btn-sm">
                    <Radio size={14} /> Start
                  </Link>
                  <Link to={`/teacher/reports?courseId=${c.id}`} className="md-btn md-btn-outlined md-btn-sm">
                    <Users size={14} /> Report
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
