import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';

export default function TeacherDashboard() {
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ courseName: '', courseCode: '', creditHours: 3 });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/courses');
      setCourses(data.courses);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load courses');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      await api.post('/courses', form);
      setForm({ courseName: '', courseCode: '', creditHours: 3 });
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to create course');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="container py-4">
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row">
        <div className="col-md-8">
          <h4 className="mb-3">My Courses</h4>
          <div className="row g-3">
            {courses.length === 0 && <p className="text-muted">No courses yet. Create one to get started.</p>}
            {courses.map((c) => (
              <div className="col-md-6" key={c.id}>
                <div className="card h-100">
                  <div className="card-body d-flex flex-column">
                    <h6 className="card-title">{c.course_name}</h6>
                    <p className="card-text text-muted mb-3">{c.course_code}</p>
                    <div className="mt-auto d-flex gap-2">
                      <Link to={`/teacher/courses/${c.id}/session/new`} className="btn btn-sm btn-primary">
                        Start session
                      </Link>
                      <Link to={`/teacher/reports?courseId=${c.id}`} className="btn btn-sm btn-outline-secondary">
                        Reports
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-md-4">
          <h5 className="mb-3">Create a course</h5>
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
