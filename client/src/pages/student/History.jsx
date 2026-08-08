import { useEffect, useState } from 'react';
import api from '../../api/client';
import AppShell from '../../components/AppShell';

export default function AttendanceHistory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/attendance/history')
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error?.message || 'Failed to load history'));
  }, []);

  const pct = data?.attendancePercentage ?? 0;

  return (
    <AppShell title="Attendance">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="md-headline-small mb-1" style={{ color: 'var(--md-on-surface)' }}>
            My attendance
          </h2>
          <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
            Every session you have checked in to.
          </p>
        </div>
        {data && (
          <div className="md-card md-card-primary md-card-pad text-center" style={{ minWidth: 160 }}>
            <div className="md-display-small" style={{ fontWeight: 500 }}>
              {pct}%
            </div>
            <div className="md-label-medium text-uppercase">Overall</div>
          </div>
        )}
      </div>

      {error && (
        <div className="md-banner md-banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {!data && !error && (
        <div className="d-flex justify-content-center py-5">
          <div className="md-spinner" role="status" aria-label="Loading" />
        </div>
      )}

      {data && (
        <div className="md-table-wrap">
          <div className="md-scroll-x">
            <table className="md-table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Session date</th>
                  <th>Checked in</th>
                  <th>Distance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.records.length === 0 && (
                  <tr>
                    <td colSpan={5} className="md-table-empty">
                      No attendance recorded yet.
                    </td>
                  </tr>
                )}
                {data.records.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="md-title-small" style={{ color: 'var(--md-on-surface)' }}>
                        {r.course_name}
                      </div>
                      <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                        {r.course_code}
                      </div>
                    </td>
                    <td>{new Date(r.start_time).toLocaleString()}</td>
                    <td>{new Date(r.submitted_at).toLocaleString()}</td>
                    <td>{r.distance_meters !== null ? `${Math.round(r.distance_meters)} m` : '—'}</td>
                    <td>
                      <span className="md-badge md-badge-success">Present</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
