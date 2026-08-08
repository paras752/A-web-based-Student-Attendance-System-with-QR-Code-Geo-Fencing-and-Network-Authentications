import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Lock, Mail, ShieldAlert } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppShell from '../../components/AppShell';

function initialsOf(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
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

export default function AdminProfile() {
  const { changePassword, logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [account, setAccount] = useState(null);
  const [adminCount, setAdminCount] = useState(null);

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, usersRes] = await Promise.all([
          api.get('/auth/me'),
          api.get('/admin/users', { params: { role: 'admin' } }),
        ]);
        if (cancelled) return;
        setAccount(meRes.data.user);
        setAdminCount(usersRes.data.users.length);
      } catch (err) {
        if (!cancelled) setLoadError(err.response?.data?.error?.message || 'Failed to load your profile');
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
                <span
                  className="d-inline-flex align-items-center gap-2 md-body-medium"
                  style={{ color: 'var(--md-on-surface-variant)' }}
                >
                  <Mail size={16} /> {account.email}
                </span>
              </div>
              <span className="md-badge md-badge-error">{account.role}</span>
            </div>

            {/* The lockout warning is the whole reason this page earns its place: an admin is
                the only role that can reset anyone's password, so if there is exactly one and
                its password is lost, nobody can get back in without database access. */}
            {adminCount === 1 && (
              <div className="md-banner md-banner-warning" role="status">
                <ShieldAlert size={20} className="flex-shrink-0" />
                <span>
                  You are the <strong>only administrator</strong>. Password resets are
                  admin-only and there is no email recovery, so if you lose this password
                  nobody can restore access without direct database work. Create a second
                  admin account from <strong>Users → Add user</strong>.
                </span>
              </div>
            )}

            <div className="row g-4">
              <div className="col-lg-7">
                <div className="md-card md-card-elevated md-card-pad">
                  <h3 className="md-title-large mb-4" style={{ color: 'var(--md-on-surface)' }}>
                    Account details
                  </h3>
                  <dl className="mb-0">
                    <DetailRow label="Full name" value={account.name} />
                    <DetailRow label="Email" value={account.email} />
                    <DetailRow label="Role" value="Administrator" />
                    <DetailRow
                      label="Member since"
                      value={new Date(account.created_at).toLocaleDateString()}
                      last
                    />
                  </dl>

                  <div className="md-banner md-banner-info mt-4 mb-0">
                    <Lock size={20} className="flex-shrink-0" />
                    <span>
                      Change your own name or email from <strong>Users → Edit</strong>, the same
                      route used for everyone else — so every change to an account goes through
                      one audited path.
                    </span>
                  </div>
                </div>
              </div>

              <div className="col-lg-5">
                <div className="md-card md-card-elevated md-card-pad">
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
                        Password changed. All your other sessions were signed out — redirecting
                        you to sign in again…
                      </span>
                    </div>
                  ) : (
                    <form onSubmit={handleChangePassword}>
                      <div className="md-field">
                        <label className="md-field-label" htmlFor="a-cur">Current password</label>
                        <input
                          id="a-cur"
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
                        <label className="md-field-label" htmlFor="a-new">New password</label>
                        <input
                          id="a-new"
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
                        <label className="md-field-label" htmlFor="a-confirm">Confirm new password</label>
                        <input
                          id="a-confirm"
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
              </div>
            </div>
          </>
        )
      )}
    </AppShell>
  );
}
