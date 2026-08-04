import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const HOME_BY_ROLE = {
  student: '/student',
  teacher: '/teacher',
  admin: '/admin',
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="navbar navbar-expand navbar-dark bg-dark px-3 sticky-top shadow-sm">
      <Link className="navbar-brand fw-semibold" to={user ? HOME_BY_ROLE[user.role] : '/'}>
        SSAS
      </Link>
      <div className="ms-auto d-flex align-items-center gap-3">
        {user && (
          <>
            <span className="text-light small">
              {user.name} <span className="badge bg-secondary text-uppercase">{user.role}</span>
            </span>
            <button className="btn btn-outline-light btn-sm" onClick={handleLogout}>
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
