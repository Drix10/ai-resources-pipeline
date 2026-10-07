'use client';

import { useEffect, useState } from 'react';

// Bengaluru time, shown as a quiet footer line. Renders nothing until mounted so
// server and client markup match.
export default function LocalTimeBadge() {
  const [time, setTime] = useState('');

  useEffect(() => {
    const format = () =>
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(new Date());
    setTime(format());
    const id = setInterval(() => setTime(format()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <p className="text-faint" suppressHydrationWarning>
      Bengaluru{time ? `, ${time} local time` : ''}
    </p>
  );
}
