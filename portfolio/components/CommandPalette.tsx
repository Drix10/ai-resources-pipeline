'use client';

import React, { useEffect, useState } from 'react';
import { Search, Terminal, Laptop, User, Sparkles, Mail, ExternalLink, X, Code2 } from 'lucide-react';

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const ACTIONS = [
    {
      label: 'Explore 8,950+ Technical Guides',
      category: 'Publications',
      href: 'https://blogs.drix10.com',
      external: true,
      icon: Sparkles,
    },
    {
      label: 'GitHub Profile (@Drix10)',
      category: 'Social & Code',
      href: 'https://github.com/Drix10',
      external: true,
      icon: Code2,
    },
    {
      label: 'Connect on LinkedIn',
      category: 'Professional',
      href: 'https://www.linkedin.com/in/drix10',
      external: true,
      icon: User,
    },
    {
      label: 'View CosLynx AI Repository',
      category: 'Projects',
      href: 'https://github.com/Drix10/CosLynx',
      external: true,
      icon: Terminal,
    },
    {
      label: 'View AI Resources Pipeline Repository',
      category: 'Projects',
      href: 'https://github.com/Drix10/ai-resources',
      external: true,
      icon: Laptop,
    },
    {
      label: 'Jump to Featured Startups',
      category: 'Navigation',
      href: '#startups',
      external: false,
      icon: Terminal,
    },
    {
      label: 'Jump to Technical Projects',
      category: 'Navigation',
      href: '#projects',
      external: false,
      icon: Laptop,
    },
    {
      label: 'Jump to Career Experience',
      category: 'Navigation',
      href: '#experience',
      external: false,
      icon: User,
    },
    {
      label: 'Send Direct Email',
      category: 'Contact',
      href: 'mailto:drix10.official@gmail.com',
      external: false,
      icon: Mail,
    },
  ];

  const filtered = ACTIONS.filter(
    (a) =>
      a.label.toLowerCase().includes(query.toLowerCase()) ||
      a.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-mono transition-colors select-none"
        title="Quick Command Menu (Ctrl+K / ⌘K)"
      >
        <Search className="w-3.5 h-3.5" />
        <span>Quick Menu</span>
        <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-400">
          ⌘K
        </kbd>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 sm:pt-28 px-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
              <Search className="w-4 h-4 text-zinc-400" />
              <input
                type="text"
                autoFocus
                placeholder="Search commands, projects, links..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
              />
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-2 space-y-1 text-xs">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 font-mono">No matching results found.</div>
              ) : (
                filtered.map((item) => {
                  const Icon = item.icon;
                  return (
                    <a
                      key={item.label}
                      href={item.href}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noreferrer' : undefined}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center justify-between px-3 py-2.5 rounded-xl text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4 text-zinc-400 group-hover:text-emerald-400 transition-colors" />
                        <span className="font-medium">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-zinc-500">{item.category}</span>
                        {item.external && <ExternalLink className="w-3 h-3 text-zinc-500" />}
                      </div>
                    </a>
                  );
                })
              )}
            </div>

            <div className="px-4 py-2 bg-zinc-950/60 border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-500">
              <span>Navigate with mouse or keyboard</span>
              <span>ESC to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
