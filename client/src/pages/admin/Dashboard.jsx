import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  GraduationCap,
  Hand,
  Radio,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppShell from '../../components/AppShell';
import DashboardHeading from '../../components/DashboardHeading';

const POLL_MS = 30000;

// Plain English, and each one says WHO acts on it. The administration office does not fix
// Wi-Fi or choose a geofence radius itself - it decides whether to raise the matter with IT
// or with the teacher, so the hint names that rather than describing the fault.
const FAILURE_MEANING = {
  QR_EXPIRED: { label: 'QR code expired before scanning', owner: 'Ask the teacher to allow a longer QR window in large rooms.' },
  QR_INVALID: { label: 'QR code not valid', owner: 'Usually a photo of an old code, or the wrong session.' },
  SESSION_INACTIVE: { label: 'Session was not running', owner: 'Students scanning outside the timetabled class window.' },
  GEOFENCE_MISSING_COORDINATES: { label: 'No location from device', owner: 'Location blocked on the phone, or weak GPS indoors.' },
  GEOFENCE_OUT_OF_RANGE: { label: 'Outside the classroom area', owner: 'The radius set for that room may be too tight — raise with the teacher.' },
  NETWORK_UNAUTHORISED: { label: 'Not on the authorised network', owner: 'Campus Wi-Fi or the configured subnet — one for IT.' },
};

function StatCard({ label, value, sub, icon: Icon, tone, to }) {
  const body = (
    <div className={`md-card ${tone === 'primary' ? 'md-card-primary' : 'md-card-filled'} md-card-pad h-100`}>
      <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
        <span
          className="md-label-medium text-uppercase"
          style={{ color: tone === 'primary' ? 'inherit' : 'var(--md-on-surface-variant)', opacity: tone === 'primary' ? 0.9 : 1 }}
        >
          {label}
        </span>
        <Icon size={20} style={{ opacity: 0.8, flexShrink: 0 }} />
      </div>
      <div className="md-display-small" style={{ fontWeight: 500 }}>
        {value}
      </div>
      {sub && (
        <div className="md-body-small mt-2" style={{ color: tone === 'primary' ? 'inherit' : 'var(--md-on-surface-variant)', opacity: tone === 'primary' ? 0.85 : 1 }}>
          {sub}
        </div>
      )}
    </div>
  );
  return <div className="col-md-4 col-xl-3">{to ? <Link to={to} className="text-decoration-none d-block h-100">{body}</Link> : body}</div>;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (quiet) => {
    try {
      const { data: d } = await api.get('/admin/analytics');
      setData(d);
      if (!quiet) setError('');
    } catch (err) {
      if (!quiet) setError(err.response?.data?.error?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
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

  const att = data?.attendance;
  const delta = att?.current !== null && att?.previous !== null ? att.current - att.previous : null;
  const min = data?.minimumAttendancePercent ?? 75;
  const gaps = data?.gaps || {};
  const gapList = [
    { n: gaps.coursesWithoutTeacher, label: 'course with no teacher assigned', plural: 'courses with no teacher assigned', to: '/admin/courses' },
    { n: gaps.coursesWithoutStudents, label: 'course with nobody enrolled', plural: 'courses with nobody enrolled', to: '/admin/courses' },
    { n: gaps.studentsWithoutCourses, label: 'student enrolled in nothing', plural: 'students enrolled in nothing', to: '/admin/users' },
    { n: gaps.teachersWithoutCourses, label: 'teacher with no courses', plural: 'teachers with no courses', to: '/admin/users' },
  ].filter((g) => g.n > 0);

  return (
    <AppShell title="Dashboard">
      <DashboardHeading name={user?.name} details={['Administration']} />

      {error && (
        <div className="md-banner md-banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className="row g-3 mb-4">
        <StatCard
          label="Attendance this week"
          tone="primary"
          icon={att?.current !== null && delta !== null && delta < 0 ? TrendingDown : TrendingUp}
          value={att?.current === null ? '—' : `${att.current}%`}
          sub={
            att?.current === null
              ? 'No sessions held this week'
              : delta === null
                ? `across ${att.sessionsThisWeek} session${att.sessionsThisWeek === 1 ? '' : 's'}`
                : `${delta >= 0 ? '+' : ''}${Math.round(delta * 10) / 10}% vs last week`
          }
        />
        <StatCard
          label="Students"
          icon={GraduationCap}
          value={data.users.students}
          sub={`${data.users.teachers} teachers · ${data.users.admins} admins`}
          to="/admin/users"
        />
        <StatCard
          label="Courses"
          icon={BookOpen}
          value={data.totalCourses}
          sub={`${data.sessionsThisWeek} session${data.sessionsThisWeek === 1 ? '' : 's'} this week`}
          to="/admin/courses"
        />
        <StatCard
          label="Live now"
          icon={Radio}
          value={data.activeSessions}
          sub={data.activeSessions > 0 ? 'classes running' : 'nothing running'}
        />
      </div>

      {/* Configuration gaps come before the analytics: a course with nobody enrolled produces
          a clean-looking empty report rather than an error, so nothing else on this page
          would reveal it. */}
      {gapList.length > 0 && (
        <div className="md-banner md-banner-warning" role="status">
          <AlertTriangle size={20} className="flex-shrink-0" />
          <div>
            <strong>Setup needs attention</strong>
            <ul className="mb-0 mt-1 ps-3">
              {gapList.map((g) => (
                <li key={g.label} className="md-body-small">
                  <Link to={g.to} className="md-link">
                    {g.n} {g.n === 1 ? g.label : g.plural}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="row g-4">
        <div className="col-lg-7">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Course health
            </h3>
            <Link to="/admin/courses" className="md-btn md-btn-text md-btn-sm">
              Manage <ArrowRight size={15} />
            </Link>
          </div>

          <div className="md-table-wrap">
            <div className="md-scroll-x">
              <table className="md-table">
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Teacher</th>
                    <th>Enrolled</th>
                    <th>Sessions</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.courses.length === 0 && (
                    <tr>
                      <td colSpan={5} className="md-table-empty">No courses yet.</td>
                    </tr>
                  )}
                  {data.courses.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="md-title-small">{c.courseCode}</div>
                        <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {c.courseName}
                        </div>
                      </td>
                      <td style={{ color: 'var(--md-on-surface-variant)' }}>
                        {c.teacherName || <span style={{ color: 'var(--md-error)' }}>Unassigned</span>}
                      </td>
                      <td style={{ color: 'var(--md-on-surface-variant)' }}>{c.enrolled}</td>
                      <td style={{ color: 'var(--md-on-surface-variant)' }}>{c.sessionsHeld}</td>
                      <td>
                        {c.attendanceRate === null ? (
                          // Not 0% - no classes have run, so there is no rate to report.
                          <span className="md-badge md-badge-neutral">Not started</span>
                        ) : (
                          <span className={`md-badge ${c.atRisk ? 'md-badge-error' : 'md-badge-success'}`}>
                            {c.attendanceRate}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <h3 className="md-title-large mb-3" style={{ color: 'var(--md-on-surface)' }}>
            Below {min}%
          </h3>
          <div className="row g-3 mb-4">
            <div className="col-6">
              <div className="md-card md-card-outlined md-card-pad text-center h-100">
                <div
                  className="md-display-small"
                  style={{ fontWeight: 500, color: data.coursesAtRisk > 0 ? 'var(--md-error)' : 'var(--md-on-surface)' }}
                >
                  {data.coursesAtRisk}
                </div>
                <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                  course{data.coursesAtRisk === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <div className="col-6">
              <div className="md-card md-card-outlined md-card-pad text-center h-100">
                <div
                  className="md-display-small"
                  style={{ fontWeight: 500, color: data.studentsAtRisk > 0 ? 'var(--md-error)' : 'var(--md-on-surface)' }}
                >
                  {data.studentsAtRisk}
                </div>
                <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                  student-course enrolments
                </div>
              </div>
            </div>
          </div>

          {/* Only the admin sees this, and only the admin should: it is the share of the
              attendance record that a teacher asserted rather than the three factors
              verified. Useful as a trend, not as an accusation. */}
          <div className="d-flex align-items-center gap-2 mb-3">
            <ShieldCheck size={18} style={{ color: 'var(--md-on-surface-variant)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Record integrity
            </h3>
          </div>
          <div className="md-card md-card-outlined md-card-pad mb-4">
            <div className="d-flex justify-content-between align-items-baseline mb-2">
              <span className="md-body-medium" style={{ color: 'var(--md-on-surface-variant)' }}>
                Verified by scan
              </span>
              <span className="md-title-small" style={{ color: 'var(--md-on-surface)' }}>
                {data.totalAttendanceRecords - data.manualRecords} of {data.totalAttendanceRecords}
              </span>
            </div>
            <div className="d-flex justify-content-between align-items-baseline">
              <span className="md-body-medium d-inline-flex align-items-center gap-2" style={{ color: 'var(--md-on-surface-variant)' }}>
                <Hand size={14} /> Marked manually
              </span>
              <span
                className="md-title-small"
                style={{ color: data.manualSharePercent > 25 ? 'var(--md-warning)' : 'var(--md-on-surface)' }}
              >
                {data.manualRecords}
                {data.manualSharePercent !== null ? ` (${data.manualSharePercent}%)` : ''}
              </span>
            </div>
            {data.manualSharePercent > 25 && (
              <p className="md-body-small mb-0 mt-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                More than a quarter of attendance is teacher-asserted rather than verified.
                Usually a sign the automated checks are failing somewhere — see below.
              </p>
            )}
          </div>

          <h3 className="md-title-large mb-3" style={{ color: 'var(--md-on-surface)' }}>
            Why check-ins fail
          </h3>
          {data.failureReasons.length === 0 ? (
            <div className="md-card md-card-outlined md-card-pad text-center">
              <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
                No failed check-in attempts in the last 7 days.
              </p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {data.failureReasons.map((f) => {
                const meta = FAILURE_MEANING[f.outcome] || { label: f.outcome, owner: '' };
                return (
                  <div key={f.outcome} className="md-card md-card-outlined md-card-pad">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div>
                        <div className="md-title-small" style={{ color: 'var(--md-on-surface)' }}>
                          {meta.label}
                        </div>
                        <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {meta.owner}
                        </div>
                      </div>
                      <span className="md-badge md-badge-warning flex-shrink-0">
                        {f.attempts} · {f.students} student{f.students === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
