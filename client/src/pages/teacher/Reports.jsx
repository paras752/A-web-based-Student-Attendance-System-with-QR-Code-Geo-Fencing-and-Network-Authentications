import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';

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
    <div className="container py-4">
      <h4 className="mb-3">Attendance Reports</h4>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-2 align-items-end mb-4">
        <div className="col-md-4">
          <label className="form-label">Course</label>
          <select className="form-select" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.course_name} ({c.course_code})
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label">From</label>
          <input type="date" className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="col-md-3">
          <label className="form-label">To</label>
          <input type="date" className="form-control" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="col-md-2">
          <button className="btn btn-primary w-100" onClick={runReport} disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
      </div>

      {report && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="mb-0">
              {report.course.course_name} — {report.sessionCount} session(s) in range
            </h6>
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-outline-secondary" onClick={() => download('pdf')}>
                Download PDF
              </button>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => download('xlsx')}>
                Download Excel
              </button>
            </div>
          </div>
          <div className="table-responsive">
            <table className="table table-striped">
              <thead>
                <tr>
                  <th>Student number</th>
                  <th>Name</th>
                  <th>Present</th>
                  <th>Total sessions</th>
                  <th>Attendance %</th>
                </tr>
              </thead>
              <tbody>
                {report.summary.map((s) => (
                  <tr key={s.studentId}>
                    <td>{s.studentNumber}</td>
                    <td>{s.studentName}</td>
                    <td>{s.presentCount}</td>
                    <td>{s.totalSessions}</td>
                    <td>{s.attendancePercentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
