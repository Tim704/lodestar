// App shell: star-chart sidebar (desktop) / bottom bar (mobile), the bell,
// the command bar (Ctrl-K), and the theme toggle.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { CommandBar } from './CommandBar';
import { Bell } from './Bell';

const NAV = [
  { to: '/', label: 'Today', icon: '✦' },
  { to: '/tasks', label: 'Tasks', icon: '◈', accent: 'text-m-tasks' },
  { to: '/calendar', label: 'Calendar', icon: '☾', accent: 'text-m-calendar' },
  { to: '/study', label: 'Study', icon: '△', accent: 'text-m-study' },
  { to: '/notes', label: 'Notes', icon: '❏', accent: 'text-m-notes' },
  { to: '/backlog', label: 'Backlog', icon: '☰', accent: 'text-m-backlog' },
  { to: '/watchers', label: 'Watchers', icon: '◉', accent: 'text-m-watchers' },
];

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('lodestar-theme', next ? 'dark' : 'light');
  };
  return [dark, toggle];
}

export function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [dark, toggleTheme] = useTheme();
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-sm border-2 px-3 py-1.5 text-sm font-semibold transition-colors ${
      isActive
        ? 'border-ink bg-gold text-white shadow-almanac-sm'
        : 'border-transparent hover:border-line'
    }`;

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col md:flex-row">
      {/* sidebar (desktop) */}
      <aside className="hidden w-52 shrink-0 flex-col gap-1 p-4 md:flex">
        <div className="mb-3 flex items-center gap-2 px-1">
          <span className="text-2xl text-gold">✦</span>
          <span className="h-display text-xl">Lodestar</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={linkClass} end={n.to === '/'}>
            <span className={n.accent ?? 'text-gold'}>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col gap-1 pt-4">
          <button className="btn-ghost justify-start !shadow-none !border-transparent hover:!border-line" onClick={() => setCmdOpen(true)}>
            ⌘ <span className="text-muted">Search / capture</span>
            <kbd className="ml-auto text-[10px] text-muted">Ctrl K</kbd>
          </button>
          <NavLink to="/review" className={linkClass}>
            <span className="text-gold">✉</span> Weekly review
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            <span
              className="inline-block h-3 w-3 rounded-full border border-ink"
              style={{ background: user?.color }}
            />
            {user?.display_name}
          </NavLink>
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-4 md:justify-end">
          <div className="flex items-center gap-2 md:hidden">
            <span className="text-xl text-gold">✦</span>
            <span className="h-display text-lg">Lodestar</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost !px-2.5 md:hidden"
              onClick={() => setCmdOpen(true)}
              aria-label="Search"
            >
              ⌘
            </button>
            <Bell />
            <button className="btn-ghost !px-2.5" onClick={toggleTheme} aria-label="Toggle theme">
              {dark ? '☀' : '☾'}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-2 md:pb-8">{children}</main>
      </div>

      {/* bottom bar (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t-2 border-ink bg-panel px-1 py-1.5 md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center rounded-sm px-2 py-0.5 text-[10px] font-semibold ${
                isActive ? 'text-gold' : 'text-muted'
              }`
            }
          >
            <span className="text-base leading-5">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex flex-col items-center rounded-sm px-2 py-0.5 text-[10px] font-semibold ${
              isActive ? 'text-gold' : 'text-muted'
            }`
          }
        >
          <span className="text-base leading-5">⚙</span>
          More
        </NavLink>
      </nav>

      {cmdOpen && <CommandBar onClose={() => setCmdOpen(false)} />}
    </div>
  );
}
