import { useEffect, useState } from 'react';

// Shared by the student and teacher dashboards so both greet you the same way: who you are,
// which faculty/programme you belong to, and what day and time it is. Kept in one component
// rather than copied, so the two cannot drift into looking like different products.

function greeting(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardHeading({ name, details = [], children }) {
  // Ticks so the clock is a clock rather than the time the page happened to load - and so
  // the greeting flips from morning to afternoon without a refresh.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const dayAndDate = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const parts = [...details.filter(Boolean), dayAndDate, time];

  return (
    <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-4">
      <div>
        <h2 className="md-headline-medium mb-1" style={{ color: 'var(--md-on-surface)' }}>
          {greeting(now.getHours())}, {name || 'there'}
        </h2>
        <p className="md-body-large mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
          {parts.join(' • ')}
        </p>
      </div>
      {children}
    </div>
  );
}
