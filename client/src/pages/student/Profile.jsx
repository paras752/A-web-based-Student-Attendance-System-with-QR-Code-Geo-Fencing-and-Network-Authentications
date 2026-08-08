import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CalendarCheck, IdCard, KeyRound, Lock, Mail, TrendingUp, UserRound } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppShell from '../../components/AppShell';

function initialsOf(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function DetailRow({ label, value, last }) {
  return (
    <div
      className="d-flex justify-content-between align-items-baseline gap-3 py-3"
      style={{ borderBottom: last ? 'none' : '1px solid var(--md-outline-variant)' }}
    >
      <dt className="md-body-medium m-0 fw-normal" style={{ color: 'var(--md-on-surface-variant)' }}>
        {label}
      </dt>
      <dd className="md-title-small m-0 text-end" style={{ color: 'var(--md-on-surface)' }}>
        {value || '—'}
      </dd>
    </div>
  );
}

function StatTile({ icon: Icon, label, value }) {
  return (
    <div className="col-sm-4">
      <div className="md-card md-card-filled md-card-pad h-100 d-flex align-items-center gap-3">
        <div
          className="d-flex align-items-center justify-content-center flex-shrink-0"
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--md-shape-md)',
            background: 'var(--md-primary-container)',
            color: 'var(--md-on-primary-container)',
          }}
        >
          <Icon size={22} />
        </div>
        <div>
          <div className="md-label-medium text-uppercase" style={{ color: 'var(--md-on-surface-variant)' }}>
            {label}
          </div>
          <div className="md-headline-small" style={{ color: 'var(--md-on-surface)' }}>
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StudentProfile() {
  const { changePassword, logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [account, setAccount] = useState(null);
  const [stats, setStats] = useState(null);

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, historyRes, coursesRes] = await Promise.all([
          api.get('/auth/me'),
          api.get('/attendance/history'),
          api.get('/courses'),
        ]);
        if (cancelled) return;
        const me = meRes.data.user;
        setAccount(me);
        setStats({
          attendancePercentage: historyRes.data.attendancePercentage,
          recordCount: historyRes.data.records.length,
          courseCount: coursesRes.data.courses.length,
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err.response?.data?.error?.message || 'Failed to load your profile');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePwChange = (e) => {
    setPwForm({ ...pwForm, [e.target.name]: e.target.value });
    setPwError('');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('The two new passwords do not match');
      return;
    }
    setSavingPw(true);
    setPwError('');
    try {
      await changePassword(pwForm.currentPassword, pwForm.newPassword);
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwDone(true);
      // Changing the password revoked every refresh token server-side, so this session
      // cannot be renewed. Send them back to login rather than let it die mid-action.
      setTimeout(async () => {
        await logout();
        navigate('/login');
      }, 2500);
    } catch (err) {
      setPwError(err.response?.data?.error?.message || 'Could not change your password');
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <AppShell title="Profile">
      {loadError && (
        <div className="md-banner md-banner-error" role="alert">
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className="d-flex justify-content-center py-5">
          <div className="md-spinner" role="status" aria-label="Loading" />
        </div>
      ) : (
        account && (
          <>
            <div className="md-card md-card-elevated md-card-pad mb-4 d-flex align-items-center gap-4 flex-wrap">
              <div
                className="d-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: 'var(--md-primary)',
                  color: 'var(--md-on-primary)',
                  fontSize: 28,
                  fontWeight: 500,
                }}
              >
                {initialsOf(account.name)}
              </div>
              <div className="flex-grow-1">
                <h2 className="md-headline-small mb-2" style={{ color: 'var(--md-on-surface)' }}>
                  {account.name}
                </h2>
                <div className="d-flex align-items-center gap-3 flex-wrap md-body-medium" style={{ color: 'var(--md-on-surface-variant)' }}>
                  <span className="d-inline-flex align-items-center gap-2">
                    <Mail size={16} /> {account.email}
                  </span>
                  <span className="d-inline-flex align-items-center gap-2">
                    <IdCard size={16} /> {account.profile?.student_number || '—'}
                  </span>
                </div>
              </div>
              <span className="md-badge md-badge-tertiary">{account.role}</span>
            </div>

            {stats && (
              <div className="row g-3 mb-4">
                <StatTile icon={TrendingUp} label="Attendance" value={`${stats.attendancePercentage}%`} />
                <StatTile icon={CalendarCheck} label="Sessions attended" value={stats.recordCount} />
                <StatTile icon={BookOpen} label="Enrolled courses" value={stats.courseCount} />
              </div>
            )}

            <div className="row g-4">
              <div className="col-lg-7">
                <div className="md-card md-card-elevated md-card-pad">
                  <div className="d-flex align-items-center gap-2 mb-4">
                    <UserRound size={20} style={{ color: 'var(--md-primary)' }} />
                    <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
                      Personal details
                    </h3>
                  </div>

                  {/* Read-only on purpose. These are the college's record of who you are -
                      rosters and attendance reports are read against them - so corrections go
                      through the administrator rather than the person they describe. */}
                  <dl className="mb-0">
                    <DetailRow label="Full name" value={account.name} />
                    <DetailRow label="College ID" value={account.profile?.student_number} />
                    <DetailRow label="Email" value={account.email} />
                    <DetailRow label="Programme" value={account.profile?.program} />
                    <DetailRow label="Semester" value={account.profile?.semester} />
                    <DetailRow label="Section" value={account.profile?.section} last />
                  </dl>

                  <div className="md-banner md-banner-info mt-4 mb-0">
                    <Lock size={20} className="flex-shrink-0" />
                    <span>
                      These details are held by your college. Attendance records are keyed to
                      them, so if anything here is wrong, ask your administrator to correct it.
                    </span>
                  </div>
                </div>
              </div>

              <div className="col-lg-5">
                <div className="md-card md-card-elevated md-card-pad mb-4">
                  <div className="d-flex align-items-center gap-2 mb-4">
                    <KeyRound size={20} style={{ color: 'var(--md-primary)' }} />
                    <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
                      Change password
                    </h3>
                  </div>

                  {pwError && (
                    <div className="md-banner md-banner-error" role="alert">
                      <span>{pwError}</span>
                    </div>
                  )}
                  {pwDone ? (
                    <div className="md-banner md-banner-success" role="status">
                      <span>
                        Password changed. For security, all your other sessions were signed out —
                        redirecting you to sign in again…
                      </span>
                    </div>
                  ) : (
                    <form onSubmit={handleChangePassword}>
                      <div className="md-field">
                        <label className="md-field-label" htmlFor="p-cur">Current password</label>
                        <input
                          id="p-cur"
                          type="password"
                          className="md-input"
                          name="currentPassword"
                          autoComplete="current-password"
                          value={pwForm.currentPassword}
                          onChange={handlePwChange}
                          required
                        />
                      </div>
                      <div className="md-field">
                        <label className="md-field-label" htmlFor="p-new">New password</label>
                        <input
                          id="p-new"
                          type="password"
                          className="md-input"
                          name="newPassword"
                          autoComplete="new-password"
                          minLength={8}
                          value={pwForm.newPassword}
                          onChange={handlePwChange}
                          required
                        />
                        <span className="md-supporting">At least 8 characters.</span>
                      </div>
                      <div className="md-field">
                        <label className="md-field-label" htmlFor="p-confirm">Confirm new password</label>
                        <input
                          id="p-confirm"
                          type="password"
                          className="md-input"
                          name="confirmPassword"
                          autoComplete="new-password"
                          minLength={8}
                          value={pwForm.confirmPassword}
                          onChange={handlePwChange}
                          required
                        />
                      </div>
                      <button className="md-btn md-btn-filled md-btn-block" type="submit" disabled={savingPw}>
                        {savingPw ? 'Updating…' : 'Update password'}
                      </button>
                    </form>
                  )}
                </div>

                <div className="md-card md-card-outlined md-card-pad">
                  <h3 className="md-title-large mb-3" style={{ color: 'var(--md-on-surface)' }}>
                    Account
                  </h3>
                  <div className="d-flex justify-content-between md-body-medium mb-2">
                    <span style={{ color: 'var(--md-on-surface-variant)' }}>Role</span>
                    <span className="text-capitalize md-title-small" style={{ color: 'var(--md-on-surface)' }}>
                      {account.role}
                    </span>
                  </div>
                  <div className="d-flex justify-content-between md-body-medium">
                    <span style={{ color: 'var(--md-on-surface-variant)' }}>Member since</span>
                    <span className="md-title-small" style={{ color: 'var(--md-on-surface)' }}>
                      {new Date(account.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )
      )}
    </AppShell>
  );
}
