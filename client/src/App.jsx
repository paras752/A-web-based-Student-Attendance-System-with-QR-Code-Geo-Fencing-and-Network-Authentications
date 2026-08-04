import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

import Login from './pages/auth/Login';
import Register from './pages/auth/Register';

import StudentDashboard from './pages/student/Dashboard';
import ScanAttendance from './pages/student/ScanAttendance';
import AttendanceHistory from './pages/student/History';

import TeacherDashboard from './pages/teacher/Dashboard';
import CreateSession from './pages/teacher/CreateSession';
import LiveSession from './pages/teacher/LiveSession';
import Reports from './pages/teacher/Reports';

import AdminDashboard from './pages/admin/Dashboard';
import ManageUsers from './pages/admin/ManageUsers';
import ManageCourses from './pages/admin/ManageCourses';

const HOME_BY_ROLE = {
  student: '/student',
  teacher: '/teacher',
  admin: '/admin',
};

function Home() {
  const { user, initializing } = useAuth();
  if (initializing) return <div className="text-center py-5 text-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
}

function Shell({ children }) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            <Route
              path="/student"
              element={
                <ProtectedRoute roles={['student']}>
                  <StudentDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/student/scan"
              element={
                <ProtectedRoute roles={['student']}>
                  <ScanAttendance />
                </ProtectedRoute>
              }
            />
            <Route
              path="/student/history"
              element={
                <ProtectedRoute roles={['student']}>
                  <AttendanceHistory />
                </ProtectedRoute>
              }
            />

            <Route
              path="/teacher"
              element={
                <ProtectedRoute roles={['teacher']}>
                  <TeacherDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/teacher/courses/:courseId/session/new"
              element={
                <ProtectedRoute roles={['teacher']}>
                  <CreateSession />
                </ProtectedRoute>
              }
            />
            <Route
              path="/teacher/session/:sessionId/live"
              element={
                <ProtectedRoute roles={['teacher']}>
                  <LiveSession />
                </ProtectedRoute>
              }
            />
            <Route
              path="/teacher/reports"
              element={
                <ProtectedRoute roles={['teacher']}>
                  <Reports />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute roles={['admin']}>
                  <ManageUsers />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/courses"
              element={
                <ProtectedRoute roles={['admin']}>
                  <ManageCourses />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </AuthProvider>
    </BrowserRouter>
  );
}
