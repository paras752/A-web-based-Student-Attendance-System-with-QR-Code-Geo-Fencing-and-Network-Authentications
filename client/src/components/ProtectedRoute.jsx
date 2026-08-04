import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Route-level RBAC gate: mirrors the server's role check so a student can't even see a
// teacher/admin page shell, though the real enforcement is always server-side (Section 2.7).
export default function ProtectedRoute({ roles, children }) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <div className="text-center py-5 text-muted">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
