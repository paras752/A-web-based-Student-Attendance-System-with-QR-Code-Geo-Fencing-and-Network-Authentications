import { useEffect, useState } from 'react';
import api from '../../api/client';

export default function AttendanceHistory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/attendance/history')
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error?.message || 'Failed to load history'));
  }, []);

  if (error) return <div className="container py-4"><div className="alert alert-danger">{error}</div></div>;
  if (!data) return <div className="text-center py-5">Loading…</div>;

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-3 mb-4">
        <h4 className="mb-0">My Attendance</h4>
        <span className="badge bg-primary fs-6">{data.attendancePercentage}% overall</span>
      </div>

      <div className="table-responsive">
        <table className="table table-striped">
          <thead>
            <tr>
              <th>Course</th>
              <th>Session date</th>
              <th>Checked in at</th>
              <th>Distance from classroom</th>
            </tr>
          </thead>
          <tbody>
            {data.records.length === 0 && (
              <tr>
                <td colSpan={4} className="text-muted text-center">
                  No attendance recorded yet.
                </td>
              </tr>
            )}
            {data.records.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.course_name} <span className="text-muted small">({r.course_code})</span>
                </td>
                <td>{new Date(r.start_time).toLocaleString()}</td>
                <td>{new Date(r.submitted_at).toLocaleString()}</td>
                <td>{r.distance_meters !== null ? `${Math.round(r.distance_meters)}m` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
