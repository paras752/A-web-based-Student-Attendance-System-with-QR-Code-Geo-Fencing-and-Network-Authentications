import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, Moon, ShieldCheck, Sun } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export default function Register() {
  const { register } = useAuth();
  const { isDark, toggle } = useTheme();
  const navigate = useNavigate();
  // 'unknown' until the server answers, so the form is never rendered and then yanked away.
  const [registrationOpen, setRegistrationOpen] = useState('unknown');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    studentNumber: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/status')
      .then(({ data }) => !cancelled && setRegistrationOpen(Boolean(data.allowPublicRegistration)))
      .catch(() => !cancelled && setRegistrationOpen(false));
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
      // Role is intentionally not sent: the server pins public signups to 'student'.
      // Teacher and admin accounts are provisioned by an admin.
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        profile: { studentNumber: form.studentNumber },
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const themeButton = (
    <button
      type="button"
      className="md-icon-btn"
      style={{ position: 'fixed', top: 16, right: 16 }}
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );

  // With provisioning on, this route exists only so an old bookmark lands somewhere that
  // explains itself rather than on a form that always fails.
  if (registrationOpen === false) {
    return (
      <div
        className="d-flex justify-content-center align-items-center px-3 py-5"
        style={{ minHeight: '100svh', background: 'var(--md-background)' }}
      >
        {themeButton}
        <div style={{ width: '100%', maxWidth: 448 }}>
          <div className="md-card md-card-elevated text-center" style={{ padding: 32 }}>
            <div
              className="d-flex align-items-center justify-content-center mb-3 mx-auto"
              style={{
                width: 56,
                height: 56,
                borderRadius: 'var(--md-shape-lg)',
                background: 'var(--md-primary-container)',
                color: 'var(--md-on-primary-container)',
              }}
            >
              <ShieldCheck size={28} />
            </div>
            <h1 className="md-headline-small mb-2" style={{ color: 'var(--md-on-surface)' }}>
              Accounts are issued by your college
            </h1>
            <p className="md-body-medium mb-4" style={{ color: 'var(--md-on-surface-variant)' }}>
              Attendance records are tied to your official student ID, so accounts are created
              by your institution rather than signed up for. Use the student ID and password
              you were given — or ask your administrator if you don't have them yet.
            </p>
            <Link to="/login" className="md-btn md-btn-filled md-btn-block">
              Go to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (registrationOpen === 'unknown') {
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ minHeight: '100svh', background: 'var(--md-background)' }}
      >
        <div className="md-spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div
      className="d-flex justify-content-center align-items-center px-3 py-5"
      style={{ minHeight: '100svh', background: 'var(--md-background)' }}
    >
      {themeButton}

      <div style={{ width: '100%', maxWidth: 480 }}>
        <div className="md-card md-card-elevated" style={{ padding: 32 }}>
          <div className="d-flex flex-column align-items-center text-center mb-4">
            <div
              className="d-flex align-items-center justify-content-center mb-3"
              style={{
                width: 56,
                height: 56,
                borderRadius: 'var(--md-shape-lg)',
                background: 'var(--md-primary-container)',
                color: 'var(--md-on-primary-container)',
              }}
            >
              <GraduationCap size={28} />
            </div>
            <h1 className="md-headline-small mb-1" style={{ color: 'var(--md-on-surface)' }}>
              Create an account
            </h1>
            <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
              Join the Smart Student Attendance System
            </p>
          </div>

          {error && (
            <div className="md-banner md-banner-error" role="alert">
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="md-banner md-banner-success" role="status">
              <span>Account created. Redirecting to sign in…</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="md-field">
              <label className="md-field-label" htmlFor="reg-name">
                Full name
              </label>
              <input
                id="reg-name"
                name="name"
                className="md-input"
                value={form.name}
                onChange={handleChange}
                required
                minLength={2}
              />
            </div>

            <div className="md-field">
              <label className="md-field-label" htmlFor="reg-email">
                Email
              </label>
              <input
                id="reg-email"
                type="email"
                name="email"
                className="md-input"
                value={form.email}
                onChange={handleChange}
                required
              />
            </div>

            <div className="md-field">
              <label className="md-field-label" htmlFor="reg-password">
                Password
              </label>
              <input
                id="reg-password"
                type="password"
                name="password"
                className="md-input"
                minLength={8}
                value={form.password}
                onChange={handleChange}
                required
              />
              <span className="md-supporting">At least 8 characters.</span>
            </div>

            <div className="md-field">
              <label className="md-field-label" htmlFor="reg-student-number">
                Student number
              </label>
              <input
                id="reg-student-number"
                name="studentNumber"
                className="md-input"
                value={form.studentNumber}
                onChange={handleChange}
              />
            </div>

            <div className="md-banner md-banner-info">
              <ShieldCheck size={20} className="flex-shrink-0" />
              <span>
                This form creates <strong>student</strong> accounts only. Teaching staff accounts are
                issued by your institution's administrator.
              </span>
            </div>

            <button className="md-btn md-btn-filled md-btn-block" type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <hr className="md-divider" style={{ margin: '24px 0' }} />

          <p className="md-body-medium text-center mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
            Already have an account?{' '}
            <Link to="/login" className="md-link">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
