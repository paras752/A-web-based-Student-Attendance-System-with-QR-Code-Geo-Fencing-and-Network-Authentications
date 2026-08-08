import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import api from '../../api/client';
import AppShell from '../../components/AppShell';

function defaultFrom() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

export default function Reports() {
  const [searchParams] = useSearchParams();
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(searchParams.get('courseId') || '');
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/courses').then((res) => {
      setCourses(res.data.courses);
      if (!courseId && res.data.courses.length > 0) {
        setCourseId(String(res.data.courses[0].id));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runReport = async () => {
    if (!courseId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/attendance/reports', {
        params: { courseId, from, to },
      });
      setReport(data);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (courseId) runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const download = async (format) => {
    try {
      const response = await api.get('/attendance/reports', {
        params: { courseId, from, to, format },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-report.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to download report');
    }
  };

  return (
    <AppShell title="Reports">
      <h2 className="md-headline-small mb-1" style={{ color: 'var(--md-on-surface)' }}>
        Attendance reports
      </h2>
      <p className="md-body-medium mb-4" style={{ color: 'var(--md-on-surface-variant)' }}>
        Per-student attendance for a course over a date range.
      </p>

      {error && (
        <div className="md-banner md-banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className="md-card md-card-filled md-card-pad mb-4">
        <div className="row g-3 align-items-end">
          <div className="col-md-4">
            <div className="md-field mb-0">
              <label className="md-field-label" htmlFor="r-course">Course</label>
              <select
                id="r-course"
                className="md-input"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.course_name} ({c.course_code})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="col-md-3">
            <div className="md-field mb-0">
              <label className="md-field-label" htmlFor="r-from">From</label>
              <input id="r-from" type="date" className="md-input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
          </div>
          <div className="col-md-3">
            <div className="md-field mb-0">
              <label className="md-field-label" htmlFor="r-to">To</label>
              <input id="r-to" type="date" className="md-input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="col-md-2">
            <button type="button" className="md-btn md-btn-filled md-btn-block" onClick={runReport} disabled={loading}>
              {loading ? 'Loading…' : 'Run'}
            </button>
          </div>
        </div>
      </div>

      {report && (
        <>
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
            <div>
              <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
                {report.course.course_name}
              </h3>
              <p className="md-body-small mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
                {report.sessionCount} session{report.sessionCount === 1 ? '' : 's'} in range
              </p>
            </div>
            <div className="d-flex gap-2">
              <button type="button" className="md-btn md-btn-outlined md-btn-sm" onClick={() => download('pdf')}>
                <FileText size={15} /> PDF
              </button>
              <button type="button" className="md-btn md-btn-outlined md-btn-sm" onClick={() => download('xlsx')}>
                <FileSpreadsheet size={15} /> Excel
              </button>
            </div>
          </div>

          <div className="md-table-wrap">
            <div className="md-scroll-x">
              <table className="md-table">
                <thead>
                  <tr>
                    <th>Student number</th>
                    <th>Name</th>
                    <th>Present</th>
                    <th>Total sessions</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.summary.length === 0 && (
                    <tr>
                      <td colSpan={5} className="md-table-empty">
                        No students enrolled in this course.
                      </td>
                    </tr>
                  )}
                  {report.summary.map((s) => (
                    <tr key={s.studentId}>
                      <td style={{ color: 'var(--md-on-surface-variant)' }}>{s.studentNumber}</td>
                      <td className="md-title-small">{s.studentName}</td>
                      <td>
                        {s.presentCount}
                        {/* Called out rather than folded into the total: a student whose
                            attendance is largely teacher-marked should not read identically
                            to one who scanned in every time. */}
                        {s.manualCount > 0 && (
                          <div className="md-body-small" style={{ color: 'var(--md-warning)' }}>
                            {s.manualCount} manual
                          </div>
                        )}
                      </td>
                      <td>{s.totalSessions}</td>
                      <td>
                        <span
                          className={`md-badge ${
                            s.attendancePercentage >= 75 ? 'md-badge-success' : 'md-badge-error'
                          }`}
                        >
                          {s.attendancePercentage}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
