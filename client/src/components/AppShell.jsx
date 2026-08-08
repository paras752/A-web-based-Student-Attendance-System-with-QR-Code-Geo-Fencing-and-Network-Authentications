import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  FileBarChart,
  GraduationCap,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  ScanLine,
  Sun,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const NAV_BY_ROLE = {
  student: [
    { to: '/student', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/student/scan', label: 'Scan', icon: ScanLine },
    { to: '/student/history', label: 'Attendance', icon: History },
    { to: '/student/profile', label: 'Profile', icon: UserRound },
  ],
  teacher: [
    { to: '/teacher', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/teacher/sessions', label: 'Sessions', icon: CalendarDays },
    { to: '/teacher/courses', label: 'Courses', icon: BookOpen },
    { to: '/teacher/reports', label: 'Reports', icon: FileBarChart },
    { to: '/teacher/profile', label: 'Profile', icon: UserRound },
  ],
  admin: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/courses', label: 'Courses', icon: BookOpen },
    { to: '/admin/profile', label: 'Profile', icon: UserRound },
  ],
};

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

function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
      className="md-switch"
      onClick={toggle}
    >
      <span className="md-switch-thumb">
        {isDark ? <Moon size={14} strokeWidth={2.5} /> : <Sun size={10} strokeWidth={2.5} />}
      </span>
    </button>
  );
}

export default function AppShell({ title, children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const navItems = NAV_BY_ROLE[user?.role] || [];

  // M3 top app bars lift to a container tone once content passes beneath them.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Clicking your own name goes to your profile. Every role has one now.
  const PROFILE_PATH_BY_ROLE = {
    student: '/student/profile',
    teacher: '/teacher/profile',
    admin: '/admin/profile',
  };
  const profilePath = PROFILE_PATH_BY_ROLE[user?.role] || null;

  const identityInner = (
    <>
      <div className="text-end d-none d-sm-block">
        <div className="md-label-large" style={{ color: 'var(--md-on-surface)' }}>
          {user?.name}
        </div>
        <div className="md-label-small text-capitalize" style={{ color: 'var(--md-on-surface-variant)' }}>
          {user?.role}
        </div>
      </div>
      <div className="md-avatar">{initialsOf(user?.name)}</div>
    </>
  );

  const identity = profilePath ? (
    <Link to={profilePath} className="d-flex align-items-center gap-3 text-decoration-none ms-1">
      {identityInner}
    </Link>
  ) : (
    <div className="d-flex align-items-center gap-3 ms-1">{identityInner}</div>
  );

  return (
    <div className="md-shell">
      <nav className="md-rail" aria-label="Main navigation">
        <div className="md-rail-logo">
          <GraduationCap size={26} />
        </div>

        <div className="md-rail-items">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`md-rail-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span className="md-rail-indicator">
                  <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
                </span>
                <span className="md-rail-label">{item.label}</span>
              </Link>
            );
          })}
        </div>

      </nav>

      <div className="md-main">
        <header className={`md-topbar${scrolled ? ' scrolled' : ''}`}>
          <h1 className="md-title-large mb-0 ps-2" style={{ color: 'var(--md-on-surface)' }}>
            {title}
          </h1>

          {/* Account controls live here rather than in the rail: on a phone the rail becomes
              a bottom navigation bar, and M3 caps that at five destinations - a theme switch
              and a logout button are not destinations. */}
          <div className="d-flex align-items-center gap-2">
            <ThemeToggle />

            {identity}

            <button
              type="button"
              className="md-icon-btn"
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <main className="md-content">{children}</main>
      </div>
    </div>
  );
}
