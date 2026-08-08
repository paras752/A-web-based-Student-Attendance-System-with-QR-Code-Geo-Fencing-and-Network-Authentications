import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  EyeOff,
  GraduationCap,
  Lock,
  MapPin,
  Moon,
  Sun,
  User,
  Wifi,
  WifiOff,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const HOME_BY_ROLE = {
  student: '/student',
  teacher: '/teacher',
  admin: '/admin',
};

// Reflects the two automated checks the system can actually probe before sign-in:
// whether this browser can supply a location at all, and whether the request is
// arriving from the institution's network.
function StatusChips() {
  const [network, setNetwork] = useState(null);
  const [geo, setGeo] = useState('checking');

  useEffect(() => {
    let cancelled = false;

    api
      .get('/auth/status')
      .then(({ data }) => !cancelled && setNetwork(data))
      .catch(() => !cancelled && setNetwork({ unreachable: true }));

    if (!('geolocation' in navigator)) {
      setGeo('unsupported');
    } else if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((res) => !cancelled && setGeo(res.state === 'denied' ? 'denied' : 'available'))
        .catch(() => !cancelled && setGeo('available'));
    } else {
      setGeo('available');
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const geoOk = geo === 'available';
  const netOk = network && !network.unreachable && network.onCampusNetwork;

  const geoLabel =
    geo === 'checking'
      ? 'Checking location…'
      : geo === 'unsupported'
        ? 'Location unsupported'
        : geo === 'denied'
          ? 'Location blocked'
          : 'Location ready';

  const netLabel = !network
    ? 'Checking network…'
    : network.unreachable
      ? 'Server unreachable'
      : network.onCampusNetwork
        ? network.enforced
          ? 'On campus network'
          : 'Network check open'
        : 'Off campus network';

  return (
    <div className="d-flex gap-2 justify-content-center mt-4 flex-wrap">
      <span
        className={`md-badge ${geoOk ? 'md-badge-success' : geo === 'checking' ? 'md-badge-neutral' : 'md-badge-warning'}`}
        title={
          geo === 'denied'
            ? 'You have blocked location access. Attendance check-in needs it.'
            : 'Location permission is required when you check in.'
        }
      >
        <MapPin size={12} /> {geoLabel}
      </span>
      <span
        className={`md-badge ${
          netOk ? 'md-badge-success' : !network ? 'md-badge-neutral' : 'md-badge-warning'
        }`}
        title={network?.clientIp ? `Your IP: ${network.clientIp}` : undefined}
      >
        {netOk ? <Wifi size={12} /> : <WifiOff size={12} />} {netLabel}
      </span>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const { isDark, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  // Whether self-service sign-up exists at all. Asked of the server rather than assumed, so
  // the screen never offers a "Register" link that is guaranteed to be refused.
  const [canRegister, setCanRegister] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/status')
      .then(({ data }) => !cancelled && setCanRegister(Boolean(data.allowPublicRegistration)))
      .catch(() => !cancelled && setCanRegister(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await login(form.identifier, form.password);
      const target = location.state?.from?.pathname || HOME_BY_ROLE[user.role] || '/';
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="d-flex justify-content-center align-items-center px-3 py-5"
      style={{ minHeight: '100svh', background: 'var(--md-background)' }}
    >
      <button
        type="button"
        className="md-icon-btn"
        style={{ position: 'fixed', top: 16, right: 16 }}
        onClick={toggle}
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {isDark ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <div style={{ width: '100%', maxWidth: 448 }}>
        <div className="md-card md-card-elevated" style={{ padding: 32 }}>
          <div className="d-flex flex-column align-items-center text-center mb-4">
            <div
              className="d-flex align-items-center justify-content-center mb-3"
              style={{
                width: 64,
                height: 64,
                borderRadius: 'var(--md-shape-lg)',
                background: 'var(--md-primary-container)',
                color: 'var(--md-on-primary-container)',
              }}
            >
              <GraduationCap size={32} />
            </div>
            <h1 className="md-headline-small mb-2" style={{ color: 'var(--md-on-surface)' }}>
              Smart Student Attendance
            </h1>
            <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)', maxWidth: 320 }}>
              Verified by QR code, geo-fencing and network authentication
            </p>
          </div>

          {error && (
            <div className="md-banner md-banner-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="md-field">
              <label className="md-field-label" htmlFor="login-identifier">
                Student ID or email
              </label>
              <div className="md-input-with-icon">
                <span className="md-field-icon">
                  <User size={20} />
                </span>
                <input
                  id="login-identifier"
                  type="text"
                  name="identifier"
                  className="md-input"
                  placeholder="23012003 or name@college.edu"
                  autoComplete="username"
                  value={form.identifier}
                  onChange={handleChange}
                  required
                />
              </div>
              <span className="md-supporting">
                Students: use the college ID on your card. Staff: use your email.
              </span>
            </div>

            <div className="md-field">
              <div className="d-flex justify-content-between align-items-center">
                <label className="md-field-label" htmlFor="login-password">
                  Password
                </label>
                <button
                  type="button"
                  className="md-link md-body-small mb-1"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  onClick={() => setShowRecovery((v) => !v)}
                  aria-expanded={showRecovery}
                >
                  Forgot password?
                </button>
              </div>
              <div className="md-input-with-icon">
                <span className="md-field-icon">
                  <Lock size={20} />
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  className="md-input"
                  style={{ paddingRight: 56 }}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={handleChange}
                  required
                />
                <span className="md-field-trailing">
                  <button
                    type="button"
                    className="md-icon-btn"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </span>
              </div>
            </div>

            {showRecovery && (
              <div className="md-banner md-banner-info" role="status">
                <Lock size={20} className="flex-shrink-0" />
                <span>
                  Passwords are reset by your institution's administrator. Contact them with your
                  student number or staff email and they will issue a temporary password you can
                  change from your profile after signing in.
                </span>
              </div>
            )}

            <button className="md-btn md-btn-filled md-btn-block" type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
              {!submitting && <ArrowRight size={18} />}
            </button>
          </form>

          <hr className="md-divider" style={{ margin: '24px 0' }} />

          {canRegister ? (
            <p className="md-body-medium text-center mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
              Don't have an account?{' '}
              <Link to="/register" className="md-link">
                Register
              </Link>
            </p>
          ) : (
            <p className="md-body-small text-center mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
              Accounts are issued by your institution. If you don't have your student ID or
              password, contact your college administrator.
            </p>
          )}
        </div>

        <StatusChips />
      </div>
    </div>
  );
}
