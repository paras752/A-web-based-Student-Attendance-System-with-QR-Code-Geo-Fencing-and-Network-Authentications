import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'student',
    studentNumber: '',
    department: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const profile =
        form.role === 'student'
          ? { studentNumber: form.studentNumber }
          : { department: form.department };

      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        profile,
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
      <div className="card shadow-sm" style={{ width: 420 }}>
        <div className="card-body">
          <h4 className="card-title mb-3">Create an account</h4>
          {error && <div className="alert alert-danger py-2">{error}</div>}
          {success && (
            <div className="alert alert-success py-2">Account created! Redirecting to login…</div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">Full name</label>
              <input
                name="name"
                className="form-control"
                value={form.name}
                onChange={handleChange}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Email</label>
              <input
                type="email"
                name="email"
                className="form-control"
                value={form.email}
                onChange={handleChange}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Password</label>
              <input
                type="password"
                name="password"
                className="form-control"
                minLength={8}
                value={form.password}
                onChange={handleChange}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label">I am a</label>
              <select name="role" className="form-select" value={form.role} onChange={handleChange}>
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>
            {form.role === 'student' ? (
              <div className="mb-3">
                <label className="form-label">Student number</label>
                <input
                  name="studentNumber"
                  className="form-control"
                  value={form.studentNumber}
                  onChange={handleChange}
                />
              </div>
            ) : (
              <div className="mb-3">
                <label className="form-label">Department</label>
                <input
                  name="department"
                  className="form-control"
                  value={form.department}
                  onChange={handleChange}
                />
              </div>
            )}
            <button className="btn btn-primary w-100" type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Register'}
            </button>
          </form>
          <p className="text-center mt-3 mb-0">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
