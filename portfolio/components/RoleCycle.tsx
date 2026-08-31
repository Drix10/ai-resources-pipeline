'use client';

import React, { useEffect, useState } from 'react';

const ROLES = [
  'AI Systems & LLM Architect',
  '1x Acquired Serial Founder (ReeF)',
  'Cybersecurity Researcher & AppSec',
  'Autonomous Multi-Agent Engineer',
  'Author of 8,950+ Technical Breakdowns',
];

export default function RoleCycle() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % ROLES.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="h-6 sm:h-7 overflow-hidden inline-flex items-center">
      <span
        key={index}
        className="animate-in fade-in slide-in-from-bottom-2 duration-300 font-mono text-xs sm:text-sm font-semibold text-emerald-400"
      >
        {ROLES[index]}
      </span>
    </div>
  );
}
