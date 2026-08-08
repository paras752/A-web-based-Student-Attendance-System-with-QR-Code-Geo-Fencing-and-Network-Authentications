import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Route-level RBAC gate: mirrors the server's role check so a student can't even see a
// teacher/admin page shell, though the real enforcement is always server-side (Section 2.7).
export default function ProtectedRoute({ roles, children }) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100svh' }}>
        <div className="md-spinner" role="status" aria-label="Loading" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
