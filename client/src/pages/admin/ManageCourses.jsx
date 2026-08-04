import { useEffect, useState } from 'react';
import api from '../../api/client';

export default function ManageCourses() {
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState({ courseName: '', courseCode: '', creditHours: 3, teacherId: '' });
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

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
    <div className="container py-4">
      <h4 className="mb-3">Manage Courses</h4>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row">
        <div className="col-md-7">
          <table className="table table-striped">
            <thead>
              <tr>
                <th>Course</th>
                <th>Code</th>
                <th>Teacher</th>
                <th>Credits</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td>{c.course_name}</td>
                  <td>{c.course_code}</td>
                  <td>{c.teacher_name || '—'}</td>
                  <td>{c.credit_hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="col-md-5">
          <h6>Add a course</h6>
          <form onSubmit={handleCreate} className="card card-body">
            <div className="mb-2">
              <label className="form-label">Course name</label>
              <input
                className="form-control"
                name="courseName"
                value={form.courseName}
                onChange={handleChange}
                required
              />
            </div>
            <div className="mb-2">
              <label className="form-label">Course code</label>
              <input
                className="form-control"
                name="courseCode"
                value={form.courseCode}
                onChange={handleChange}
                required
              />
            </div>
            <div className="mb-2">
              <label className="form-label">Teacher</label>
              <select className="form-select" name="teacherId" value={form.teacherId} onChange={handleChange} required>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-3">
              <label className="form-label">Credit hours</label>
              <input
                type="number"
                className="form-control"
                name="creditHours"
                value={form.creditHours}
                onChange={handleChange}
                min={1}
                max={10}
              />
            </div>
            <button className="btn btn-success" type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create course'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
