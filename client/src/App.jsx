import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';

import Login from './pages/auth/Login';
import Register from './pages/auth/Register';

import StudentDashboard from './pages/student/Dashboard';
import ScanAttendance from './pages/student/ScanAttendance';
import AttendanceHistory from './pages/student/History';
import StudentProfile from './pages/student/Profile';

import TeacherDashboard from './pages/teacher/Dashboard';
import CreateSession from './pages/teacher/CreateSession';
import LiveSession from './pages/teacher/LiveSession';
import Reports from './pages/teacher/Reports';
import TeacherProfile from './pages/teacher/Profile';
import TeacherSessions from './pages/teacher/Sessions';
import TeacherCourses from './pages/teacher/Courses';
import AdminProfile from './pages/admin/Profile';

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
  if (initializing) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100svh' }}>
        <div className="md-spinner" role="status" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
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
              path="/student/profile"
              element={
                <ProtectedRoute roles={['student']}>
                  <StudentProfile />
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
              path="/teacher/profile"
              element={
                <ProtectedRoute roles={['teacher']}>
                  <TeacherProfile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/teacher/sessions"
              element={
                <ProtectedRoute roles={['teacher']}>
                  <TeacherSessions />
                </ProtectedRoute>
              }
            />
            {/* Listed before the parameterised /teacher/courses/:courseId/session/new so the
                literal path is not swallowed by the dynamic one. */}
            <Route
              path="/teacher/courses"
              element={
                <ProtectedRoute roles={['teacher']}>
                  <TeacherCourses />
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
            <Route
              path="/admin/profile"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminProfile />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
