import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Radio, UserMinus, UserPlus, Users } from 'lucide-react';
import api from '../../api/client';
import AppShell from '../../components/AppShell';

export default function TeacherCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [rosterCourse, setRosterCourse] = useState(null);
  const [roster, setRoster] = useState({ enrolled: [], enrollable: [] });
  const [rosterLoading, setRosterLoading] = useState(false);
  const [addStudentId, setAddStudentId] = useState('');
  const [busy, setBusy] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get('/sessions/my-courses');
      setCourses(data.courses);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load your courses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadRoster = async (course) => {
    setRosterLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/courses/${course.id}/roster`);
      setRoster(data);
      setAddStudentId(data.enrollable[0] ? String(data.enrollable[0].id) : '');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load the roster');
    } finally {
      setRosterLoading(false);
    }
  };

  const openRoster = async (course) => {
    setRosterCourse(course);
    setNotice('');
    await loadRoster(course);
  };

  const handleEnrol = async (e) => {
    e.preventDefault();
    if (!addStudentId) return;
    setBusy('add');
    setError('');
    setNotice('');
    try {
      await api.post(`/courses/${rosterCourse.id}/enrol`, { studentId: Number(addStudentId) });
      setNotice('Student enrolled.');
      await Promise.all([loadRoster(rosterCourse), load()]);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to enrol that student');
    } finally {
      setBusy(null);
    }
  };

  const handleUnenrol = async (studentId, name) => {
    if (!window.confirm(`Remove ${name} from ${rosterCourse.courseCode}? Attendance already recorded is kept.`)) return;
    setBusy(studentId);
    setError('');
    setNotice('');
    try {
      await api.delete(`/courses/${rosterCourse.id}/enrol/${studentId}`);
      setNotice('Student removed from the course.');
      await Promise.all([loadRoster(rosterCourse), load()]);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to remove that student');
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell title="Courses">
      <div className="mb-4">
        <h2 className="md-headline-small mb-1" style={{ color: 'var(--md-on-surface)' }}>
          My courses
        </h2>
        <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
          Courses are assigned to you by an administrator. You manage the roster and run the
          sessions.
        </p>
      </div>

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

      {rosterCourse && (
        <div className="md-card md-card-elevated md-card-pad mb-4">
          <div className="d-flex justify-content-between align-items-start gap-3 mb-3 flex-wrap">
            <div>
              <div className="d-flex align-items-center gap-2">
                <Users size={20} style={{ color: 'var(--md-primary)' }} />
                <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
                  {rosterCourse.courseName}
                </h3>
              </div>
              <p className="md-body-small mb-0 mt-1" style={{ color: 'var(--md-on-surface-variant)' }}>
                {rosterCourse.courseCode} · {roster.enrolled.length} enrolled
              </p>
            </div>
            <button type="button" className="md-btn md-btn-text" onClick={() => setRosterCourse(null)}>
              Close
            </button>
          </div>

          <form onSubmit={handleEnrol} className="mb-4">
            <div className="row g-2 align-items-end">
              <div className="col-md-8">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="tc-add">Add a student</label>
                  <select
                    id="tc-add"
                    className="md-input"
                    value={addStudentId}
                    onChange={(e) => setAddStudentId(e.target.value)}
                    disabled={roster.enrollable.length === 0}
                  >
                    {roster.enrollable.length === 0 && <option value="">Every student is already enrolled</option>}
                    {roster.enrollable.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.student_number} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="col-md-4">
                <button
                  className="md-btn md-btn-filled md-btn-block"
                  type="submit"
                  disabled={busy === 'add' || roster.enrollable.length === 0}
                >
                  <UserPlus size={18} /> {busy === 'add' ? 'Enrolling…' : 'Enrol'}
                </button>
              </div>
            </div>
          </form>

          <div className="md-table-wrap">
            <div className="md-scroll-x">
              <table className="md-table">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Programme</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rosterLoading && (
                    <tr>
                      <td colSpan={4} className="md-table-empty">Loading…</td>
                    </tr>
                  )}
                  {!rosterLoading && roster.enrolled.length === 0 && (
                    <tr>
                      <td colSpan={4} className="md-table-empty">Nobody is enrolled yet.</td>
                    </tr>
                  )}
                  {!rosterLoading &&
                    roster.enrolled.map((s) => (
                      <tr key={s.student_id}>
                        <td className="md-title-small">{s.student_number}</td>
                        <td>{s.name}</td>
                        <td style={{ color: 'var(--md-on-surface-variant)' }}>
                          {[s.program, s.semester && `Sem ${s.semester}`, s.section].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="md-btn md-btn-danger-outlined md-btn-sm"
                            disabled={busy === s.student_id}
                            onClick={() => handleUnenrol(s.student_id, s.name)}
                          >
                            <UserMinus size={14} /> Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="d-flex justify-content-center py-5">
          <div className="md-spinner" role="status" aria-label="Loading" />
        </div>
      ) : courses.length === 0 ? (
        <div className="md-card md-card-outlined md-card-pad text-center">
          <BookOpen size={32} className="mb-3" style={{ color: 'var(--md-on-surface-variant)' }} />
          <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
            You do not own any courses yet. An administrator assigns them.
          </p>
        </div>
      ) : (
        <div className="row g-3">
          {courses.map((c) => (
            <div className="col-md-6 col-xl-4" key={c.id}>
              <div className="md-card md-card-elevated md-card-pad h-100 d-flex flex-column">
                <h3 className="md-title-large mb-1" style={{ color: 'var(--md-on-surface)' }}>
                  {c.courseName}
                </h3>
                <p className="md-body-small mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                  {c.courseCode} · {c.creditHours} credits
                </p>

                <div className="d-flex gap-4 mb-3">
                  <div>
                    <div className="md-headline-small" style={{ color: 'var(--md-on-surface)' }}>
                      {c.enrolled}
                    </div>
                    <div className="md-label-medium text-uppercase" style={{ color: 'var(--md-on-surface-variant)' }}>
                      Enrolled
                    </div>
                  </div>
                  <div>
                    <div className="md-headline-small" style={{ color: 'var(--md-on-surface)' }}>
                      {c.sessionsHeld}
                    </div>
                    <div className="md-label-medium text-uppercase" style={{ color: 'var(--md-on-surface-variant)' }}>
                      Sessions
                    </div>
                  </div>
                  <div>
                    <div
                      className="md-headline-small"
                      style={{
                        color:
                          c.attendanceRate === null
                            ? 'var(--md-on-surface-variant)'
                            : c.attendanceRate >= 75
                              ? 'var(--md-success)'
                              : 'var(--md-error)',
                      }}
                    >
                      {/* A course with no sessions has no rate; 0% would read as "nobody came". */}
                      {c.attendanceRate === null ? '—' : `${c.attendanceRate}%`}
                    </div>
                    <div className="md-label-medium text-uppercase" style={{ color: 'var(--md-on-surface-variant)' }}>
                      Attendance
                    </div>
                  </div>
                </div>

                <div className="d-flex gap-2 mt-auto flex-wrap">
                  <Link to={`/teacher/courses/${c.id}/session/new`} className="md-btn md-btn-filled md-btn-sm">
                    <Radio size={14} /> Start session
                  </Link>
                  <button type="button" className="md-btn md-btn-outlined md-btn-sm" onClick={() => openRoster(c)}>
                    <Users size={14} /> Roster
                  </button>
                  <Link to={`/teacher/reports?courseId=${c.id}`} className="md-btn md-btn-text md-btn-sm">
                    Report
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
