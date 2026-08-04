import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';

export default function StudentDashboard() {
  const [courses, setCourses] = useState([]);
  const [allCourses, setAllCourses] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enrolling, setEnrolling] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [coursesRes, allRes, activeRes] = await Promise.all([
        api.get('/courses'),
        api.get('/courses/all'),
        api.get('/sessions/active'),
      ]);
      setCourses(coursesRes.data.courses);
      setAllCourses(allRes.data.courses);
      setActiveSessions(activeRes.data.sessions);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const enrolledIds = new Set(courses.map((c) => c.id));
  const availableToEnrol = allCourses.filter((c) => !enrolledIds.has(c.id));

  const handleEnrol = async (courseId) => {
    setEnrolling(courseId);
    try {
      await api.post(`/courses/${courseId}/enrol`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to enrol');
    } finally {
      setEnrolling(null);
    }
  };

  if (loading) return <div className="text-center py-5">Loading…</div>;

  return (
    <div className="container py-4">
      {error && <div className="alert alert-danger">{error}</div>}

      {activeSessions.length > 0 && (
        <div className="alert alert-success d-flex justify-content-between align-items-center">
          <div>
            <strong>{activeSessions.length}</strong> live session(s) right now:{' '}
            {activeSessions.map((s) => s.course_name).join(', ')}
          </div>
          <Link to="/student/scan" className="btn btn-primary btn-sm">
            Scan QR to check in
          </Link>
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4>My Courses</h4>
        <Link to="/student/scan" className="btn btn-outline-primary btn-sm">
          Scan attendance QR
        </Link>
      </div>

      <div className="row g-3 mb-4">
        {courses.length === 0 && <p className="text-muted">You are not enrolled in any courses yet.</p>}
        {courses.map((c) => (
          <div className="col-md-4" key={c.id}>
            <div className="card h-100">
              <div className="card-body">
                <h6 className="card-title">{c.course_name}</h6>
                <p className="card-text text-muted mb-1">{c.course_code}</p>
                <p className="card-text small">Teacher: {c.teacher_name || '—'}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h5>Enrol in another course</h5>
      <div className="row g-3">
        {availableToEnrol.length === 0 && <p className="text-muted">No more courses available.</p>}
        {availableToEnrol.map((c) => (
          <div className="col-md-4" key={c.id}>
            <div className="card h-100">
              <div className="card-body d-flex flex-column">
                <h6 className="card-title">{c.course_name}</h6>
                <p className="card-text text-muted mb-2">{c.course_code}</p>
                <button
                  className="btn btn-sm btn-outline-success mt-auto"
                  disabled={enrolling === c.id}
                  onClick={() => handleEnrol(c.id)}
                >
                  {enrolling === c.id ? 'Enrolling…' : 'Enrol'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
