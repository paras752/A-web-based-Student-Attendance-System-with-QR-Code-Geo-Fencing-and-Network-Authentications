import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hand, MapPin, Search } from 'lucide-react';
import api from '../../api/client';
import AppShell from '../../components/AppShell';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'completed', label: 'Completed' },
];

const STATUS_BADGE = {
  live: { cls: 'md-badge-error', label: 'Live' },
  scheduled: { cls: 'md-badge-neutral', label: 'Scheduled' },
  completed: { cls: 'md-badge-success', label: 'Completed' },
};

const dateOf = (v) =>
  new Date(v).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeOf = (v) => new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function TeacherSessions() {
  const [sessions, setSessions] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (q, s) => {
    setError('');
    try {
      const { data } = await api.get('/sessions/mine', {
        params: { ...(q ? { q } : {}), ...(s ? { status: s } : {}) },
      });
      setSessions(data.sessions);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load your sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(query, status), 250);
    return () => clearTimeout(t);
  }, [query, status, load]);

  return (
    <AppShell title="Sessions">
      <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-4">
        <div>
          <h2 className="md-headline-small mb-1" style={{ color: 'var(--md-on-surface)' }}>
            All sessions
          </h2>
          <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
            {loading ? 'Loading…' : `${sessions.length} session${sessions.length === 1 ? '' : 's'} across your courses`}
          </p>
        </div>
      </div>

      {error && (
        <div className="md-banner md-banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className="d-flex gap-3 flex-wrap align-items-center mb-4">
        <div className="md-input-with-icon" style={{ flex: '1 1 280px', maxWidth: 420 }}>
          <span className="md-field-icon">
            <Search size={18} />
          </span>
          <input
            className="md-input"
            placeholder="Search by course, code or room…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search sessions"
          />
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`md-chip${status === f.key ? ' md-chip-selected' : ''}`}
              onClick={() => setStatus(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="md-table-wrap">
        <div className="md-scroll-x">
          <table className="md-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Course</th>
                <th>Room</th>
                <th>Attendance</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="md-table-empty">Loading…</td>
                </tr>
              )}
              {!loading && sessions.length === 0 && (
                <tr>
                  <td colSpan={6} className="md-table-empty">
                    {query || status ? 'No sessions match that filter.' : 'You have not run any sessions yet.'}
                  </td>
                </tr>
              )}
              {!loading &&
                sessions.map((s) => {
                  const badge = STATUS_BADGE[s.status];
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="md-label-large" style={{ color: 'var(--md-on-surface)' }}>
                          {dateOf(s.start_time)}
                        </div>
                        <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {timeOf(s.start_time)} – {timeOf(s.ended_at || s.end_time)}
                        </div>
                      </td>
                      <td>
                        <div className="md-title-small">{s.course_code}</div>
                        <div className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {s.course_name}
                        </div>
                      </td>
                      <td>
                        {s.room ? (
                          <span className="md-chip">
                            <MapPin size={13} /> {s.room}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--md-on-surface-variant)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ color: 'var(--md-on-surface)' }}>
                          {s.present}/{s.enrolled}
                        </div>
                        {/* Manual marks called out here too, so a session that was largely
                            hand-marked is visible from the list without opening it. */}
                        {s.manual > 0 && (
                          <div
                            className="md-body-small d-flex align-items-center gap-1"
                            style={{ color: 'var(--md-warning)' }}
                          >
                            <Hand size={12} /> {s.manual} manual
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`md-badge ${badge.cls}`}>
                          {s.status === 'live' && <span className="md-dot" />} {badge.label}
                        </span>
                      </td>
                      <td>
                        <Link
                          to={`/teacher/session/${s.id}/live`}
                          className={`md-btn md-btn-sm ${s.status === 'live' ? 'md-btn-filled' : 'md-btn-outlined'}`}
                        >
                          {s.status === 'live' ? 'View live' : 'Open'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
