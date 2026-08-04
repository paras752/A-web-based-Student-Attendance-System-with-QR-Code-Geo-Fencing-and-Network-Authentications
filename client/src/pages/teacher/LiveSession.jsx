import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';

const QR_REFRESH_MS = 30000;
const ROSTER_POLL_MS = 4000;

export default function LiveSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [qrImage, setQrImage] = useState(null);
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState('');
  const [ending, setEnding] = useState(false);
  const qrIntervalRef = useRef(null);
  const rosterIntervalRef = useRef(null);

  const fetchQr = useCallback(async () => {
    try {
      const { data } = await api.get(`/sessions/${sessionId}/qr`);
      setQrImage(data.qr.imageDataUrl);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to refresh QR code');
    }
  }, [sessionId]);

  const fetchRoster = useCallback(async () => {
    try {
      const { data } = await api.get(`/sessions/${sessionId}/live`);
      setRoster(data);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load live attendance');
    }
  }, [sessionId]);

  useEffect(() => {
    fetchQr();
    fetchRoster();
    qrIntervalRef.current = setInterval(fetchQr, QR_REFRESH_MS);
    rosterIntervalRef.current = setInterval(fetchRoster, ROSTER_POLL_MS);
    return () => {
      clearInterval(qrIntervalRef.current);
      clearInterval(rosterIntervalRef.current);
    };
  }, [fetchQr, fetchRoster]);

  const handleEnd = async () => {
    setEnding(true);
    try {
      await api.patch(`/sessions/${sessionId}/end`);
      navigate('/teacher');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to end session');
      setEnding(false);
    }
  };

  return (
    <div className="container py-4">
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-4">
        <div className="col-md-4 text-center">
          <h5>Show this to the class</h5>
          {qrImage ? (
            <img src={qrImage} alt="Attendance QR code" className="img-fluid border rounded" />
          ) : (
            <div className="py-5 text-muted">Loading QR…</div>
          )}
          <p className="text-muted small mt-2">Refreshes automatically every 30 seconds.</p>
          <button className="btn btn-danger" onClick={handleEnd} disabled={ending}>
            {ending ? 'Ending…' : 'End session'}
          </button>
        </div>

        <div className="col-md-8">
          <h5>
            Live attendance{' '}
            {roster && (
              <span className="badge bg-primary">
                {roster.presentCount}/{roster.totalCount}
              </span>
            )}
          </h5>
          <div className="table-responsive">
            <table className="table table-sm table-striped">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Checked in at</th>
                </tr>
              </thead>
              <tbody>
                {roster?.roster.map((r) => (
                  <tr key={r.student_id}>
                    <td>{r.name}</td>
                    <td>{r.student_number}</td>
                    <td>
                      {r.submitted_at ? (
                        <span className="badge bg-success">Present</span>
                      ) : (
                        <span className="badge bg-secondary">Absent</span>
                      )}
                    </td>
                    <td>{r.submitted_at ? new Date(r.submitted_at).toLocaleTimeString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
