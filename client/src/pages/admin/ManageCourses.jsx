import { useEffect, useState } from 'react';
import { Plus, UserMinus, UserPlus, Users } from 'lucide-react';
import api from '../../api/client';
import AppShell from '../../components/AppShell';

export default function ManageCourses() {
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState({ courseName: '', courseCode: '', creditHours: 3, teacherId: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);

  // Roster management. Enrolment is what puts a student in the official attendance report,
  // so it lives here behind the admin guard rather than on the student's own dashboard.
  const [rosterCourse, setRosterCourse] = useState(null);
  const [roster, setRoster] = useState({ enrolled: [], enrollable: [] });
  const [rosterLoading, setRosterLoading] = useState(false);
  const [addStudentId, setAddStudentId] = useState('');
  const [busyStudent, setBusyStudent] = useState(null);

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
    setBusyStudent('add');
    setError('');
    setNotice('');
    try {
      await api.post(`/courses/${rosterCourse.id}/enrol`, { studentId: Number(addStudentId) });
      setNotice('Student enrolled.');
      await loadRoster(rosterCourse);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to enrol that student');
    } finally {
      setBusyStudent(null);
    }
  };

  const handleUnenrol = async (studentId, name) => {
    if (!window.confirm(`Remove ${name} from ${rosterCourse.course_code}? Attendance already recorded is kept.`)) return;
    setBusyStudent(studentId);
    setError('');
    setNotice('');
    try {
      await api.delete(`/courses/${rosterCourse.id}/enrol/${studentId}`);
      setNotice('Student removed from the course.');
      await loadRoster(rosterCourse);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to remove that student');
    } finally {
      setBusyStudent(null);
    }
  };

  const load = async () => {
    try {
      const [coursesRes, teachersRes] = await Promise.all([
        api.get('/courses'),
        api.get('/admin/users', { params: { role: 'teacher' } }),
      ]);
      setCourses(coursesRes.data.courses);
      setTeachers(teachersRes.data.users);
      if (!form.teacherId && teachersRes.data.users.length > 0) {
        setForm((f) => ({ ...f, teacherId: String(teachersRes.data.users[0].id) }));
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load data');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      await api.post('/courses', { ...form, teacherId: Number(form.teacherId) });
      setForm({ ...form, courseName: '', courseCode: '' });
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to create course');
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell title="Courses">
      <h2 className="md-headline-small mb-1" style={{ color: 'var(--md-on-surface)' }}>
        Manage courses
      </h2>
      <p className="md-body-medium mb-4" style={{ color: 'var(--md-on-surface-variant)' }}>
        {courses.length} course{courses.length === 1 ? '' : 's'} across the institution.
      </p>

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
                  {rosterCourse.course_name}
                </h3>
              </div>
              <p className="md-body-small mb-0 mt-1" style={{ color: 'var(--md-on-surface-variant)' }}>
                {rosterCourse.course_code} · {roster.enrolled.length} enrolled
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
                  <label className="md-field-label" htmlFor="roster-add">Add a student</label>
                  <select
                    id="roster-add"
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
                  disabled={busyStudent === 'add' || roster.enrollable.length === 0}
                >
                  <UserPlus size={18} /> {busyStudent === 'add' ? 'Enrolling…' : 'Enrol'}
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
                    <th>Enrolled</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rosterLoading && (
                    <tr>
                      <td colSpan={5} className="md-table-empty">Loading…</td>
                    </tr>
                  )}
                  {!rosterLoading && roster.enrolled.length === 0 && (
                    <tr>
                      <td colSpan={5} className="md-table-empty">Nobody is enrolled in this course yet.</td>
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
                        <td style={{ color: 'var(--md-on-surface-variant)' }}>
                          {new Date(s.enrolment_date).toLocaleDateString()}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="md-btn md-btn-danger-outlined md-btn-sm"
                            disabled={busyStudent === s.student_id}
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

      <div className="row g-4">
        <div className="col-lg-7">
          <div className="md-table-wrap">
            <div className="md-scroll-x">
              <table className="md-table">
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Code</th>
                    <th>Teacher</th>
                    <th>Credits</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {courses.length === 0 && (
                    <tr>
                      <td colSpan={5} className="md-table-empty">
                        No courses yet.
                      </td>
                    </tr>
                  )}
                  {courses.map((c) => (
                    <tr key={c.id}>
                      <td className="md-title-small">{c.course_name}</td>
                      <td style={{ color: 'var(--md-on-surface-variant)' }}>{c.course_code}</td>
                      <td>{c.teacher_name || '—'}</td>
                      <td>{c.credit_hours}</td>
                      <td>
                        <button
                          type="button"
                          className="md-btn md-btn-outlined md-btn-sm"
                          onClick={() => openRoster(c)}
                        >
                          <Users size={14} /> Roster
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="md-card md-card-filled md-card-pad">
            <div className="d-flex align-items-center gap-2 mb-4">
              <Plus size={20} style={{ color: 'var(--md-primary)' }} />
              <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
                Add a course
              </h3>
            </div>
            <form onSubmit={handleCreate}>
              <div className="md-field">
                <label className="md-field-label" htmlFor="mc-name">Course name</label>
                <input
                  id="mc-name"
                  className="md-input"
                  name="courseName"
                  value={form.courseName}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="md-field">
                <label className="md-field-label" htmlFor="mc-code">Course code</label>
                <input
                  id="mc-code"
                  className="md-input"
                  name="courseCode"
                  value={form.courseCode}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="md-field">
                <label className="md-field-label" htmlFor="mc-teacher">Teacher</label>
                <select
                  id="mc-teacher"
                  className="md-input"
                  name="teacherId"
                  value={form.teacherId}
                  onChange={handleChange}
                  required
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md-field">
                <label className="md-field-label" htmlFor="mc-credits">Credit hours</label>
                <input
                  id="mc-credits"
                  type="number"
                  className="md-input"
                  name="creditHours"
                  value={form.creditHours}
                  onChange={handleChange}
                  min={1}
                  max={10}
                />
              </div>
              <button className="md-btn md-btn-filled md-btn-block" type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create course'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
