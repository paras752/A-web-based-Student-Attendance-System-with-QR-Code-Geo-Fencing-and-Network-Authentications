import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';

export default function AdminDashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/admin/analytics')
      .then((res) => setAnalytics(res.data))
      .catch((err) => setError(err.response?.data?.error?.message || 'Failed to load analytics'));
  }, []);

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h4 className="mb-0">Institution Analytics</h4>
        <div className="d-flex gap-2">
          <Link to="/admin/users" className="btn btn-outline-primary btn-sm">
            Manage users
          </Link>
          <Link to="/admin/courses" className="btn btn-outline-primary btn-sm">
            Manage courses
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {!analytics && !error && <div className="text-muted">Loading…</div>}

      {analytics && (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Students" value={analytics.users.students} />
            <StatCard label="Teachers" value={analytics.users.teachers} />
            <StatCard label="Courses" value={analytics.totalCourses} />
            <StatCard label="Active sessions now" value={analytics.activeSessions} />
            <StatCard label="Total attendance records" value={analytics.totalAttendanceRecords} />
          </div>

          <h5>Most active courses</h5>
          <table className="table table-sm table-striped">
            <thead>
              <tr>
                <th>Course</th>
                <th>Attendance records</th>
              </tr>
            </thead>
            <tbody>
              {analytics.topCourses.map((c) => (
                <tr key={c.course_code}>
                  <td>
                    {c.course_name} ({c.course_code})
                  </td>
                  <td>{c.attendanceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="col-md-2 col-6">
      <div className="card text-center h-100">
        <div className="card-body">
          <div className="fs-3 fw-bold">{value}</div>
          <div className="text-muted small">{label}</div>
        </div>
      </div>
    </div>
  );
}
