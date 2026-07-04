// App shell — CONTRACT §8 (v3): the nav layout is a property of the active
// theme. Sidebar themes keep the star-chart left rail; topbar themes get a
// horizontal bar. The mobile bottom bar exists in every theme. The old
// sun/moon toggle is gone — a dark theme is just a theme you pick.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { useTheme } from '../theme';
import { CommandBar } from './CommandBar';
import { Bell } from './Bell';

// v4 nav order (CONTRACT changelog): Fortnight is home, Overview demoted.
// `mobile` marks the subset shown in the bottom bar (5 + More).
const NAV = [
  { to: '/', label: 'Fortnight', icon: '✦', mobile: true },
  { to: '/overview', label: 'Overview', icon: '◎', mobile: true },
  { to: '/tasks', label: 'Tasks', icon: '◈', accent: 'text-m-tasks', mobile: true },
  { to: '/focus', label: 'Focus', icon: '◐', accent: 'text-m-study', mobile: true },
  { to: '/projects', label: 'Projects', icon: '⚑', accent: 'text-m-projects', mobile: true },
  { to: '/study', label: 'Study', icon: '△', accent: 'text-m-study' },
  { to: '/calendar', label: 'Calendar', icon: '☾', accent: 'text-m-calendar' },
  { to: '/notes', label: 'Notes', icon: '❏', accent: 'text-m-notes' },
  { to: '/backlog', label: 'Backlog', icon: '☰', accent: 'text-m-backlog' },
  { to: '/watchers', label: 'Watchers', icon: '◉', accent: 'text-m-watchers' },
];

/** Header theme menu — swatches rendered live via nested data-theme scopes. */
function ThemeMenu() {
  const { theme, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn-ghost !px-2.5"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${theme.label}. Change theme`}
        title={`Theme: ${theme.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        ◧
      </button>
      {open && (
        <div className="card absolute right-0 z-50 mt-2 w-60 p-1" role="menu">
          {themes.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === theme.id}
              className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-paper ${
                t.id === theme.id ? 'font-bold' : ''
              }`}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
            >
              <span
                data-theme={t.id}
                aria-hidden="true"
                className="grid h-5 w-5 flex-none place-items-center rounded-full border border-edge"
                style={{ background: 'var(--paper)' }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--accent)' }} />
              </span>
              <span className="min-w-0 flex-1">
                {t.label}
                <span className="block text-[10px] font-normal text-muted">
                  {t.nav} · {t.density}
                </span>
              </span>
              {t.id === theme.id && <span className="text-gold">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { theme } = useTheme();
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

  const railLink = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-sm border-2 px-3 py-1.5 text-sm font-semibold transition-colors ${
      isActive
        ? 'border-edge bg-gold text-accent-ink shadow-almanac-sm'
        : 'border-transparent hover:border-line'
    }`;

  const barLink = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 whitespace-nowrap rounded-sm border-2 px-2.5 py-1 text-sm font-semibold transition-colors ${
      isActive
        ? 'border-edge bg-gold text-accent-ink shadow-almanac-sm'
        : 'border-transparent hover:border-line'
    }`;

  const mobileBar = (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t-2 border-edge bg-panel px-1 py-1.5 md:hidden">
      {NAV.filter((n) => n.mobile).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
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
          `flex flex-col items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
            isActive ? 'text-gold' : 'text-muted'
          }`
        }
      >
        <span className="text-base leading-5">⚙</span>
        More
      </NavLink>
    </nav>
  );

  // ── topbar layout (graphite · ephemeris · broadsheet) ────────────────────
  if (theme.nav === 'topbar') {
    return (
      <div className="flex h-full flex-col">
        <header className="z-40 border-b-2 border-edge bg-panel">
          <div className="mx-auto flex h-12 max-w-6xl items-center gap-2 px-4">
            <NavLink to="/" className="flex items-center gap-1.5" aria-label="Lodestar home">
              <span className="text-xl text-gold">✦</span>
              <span className="h-display hidden text-lg sm:inline">Lodestar</span>
            </NavLink>
            <nav className="ml-3 hidden items-center gap-0.5 overflow-x-auto md:flex" aria-label="Primary">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={barLink} end={n.to === '/'}>
                  <span className={n.accent ?? 'text-gold'}>{n.icon}</span>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                className="btn-ghost !px-2.5"
                onClick={() => setCmdOpen(true)}
                aria-label="Search and capture (Ctrl K)"
                title="Search / capture (Ctrl K)"
              >
                ⌘
              </button>
              <Bell />
              <ThemeMenu />
              <NavLink to="/review" className="btn-ghost hidden !px-2.5 md:inline-flex" title="Weekly review">
                ✉
              </NavLink>
              <NavLink
                to="/settings"
                className="btn-ghost hidden items-center gap-1.5 md:inline-flex"
                title={`${user?.display_name} — settings`}
              >
                <span
                  className="inline-block h-3 w-3 rounded-full border border-edge"
                  style={{ background: user?.color }}
                />
                <span className="max-w-24 truncate text-xs">{user?.display_name}</span>
              </NavLink>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 md:pb-8">{children}</div>
        </main>

        {mobileBar}
        {cmdOpen && <CommandBar onClose={() => setCmdOpen(false)} />}
      </div>
    );
  }

  // ── sidebar layout (almanac · observatory · riso) ────────────────────────
  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col md:flex-row">
      <aside className="hidden w-52 shrink-0 flex-col gap-1 p-4 md:flex">
        <div className="mb-3 flex items-center gap-2 px-1">
          <span className="text-2xl text-gold">✦</span>
          <span className="h-display text-xl">Lodestar</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={railLink} end={n.to === '/'}>
            <span className={n.accent ?? 'text-gold'}>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col gap-1 pt-4">
          <button
            className="btn-ghost justify-start !border-transparent !shadow-none hover:!border-line"
            onClick={() => setCmdOpen(true)}
          >
            ⌘ <span className="text-muted">Search / capture</span>
            <kbd className="ml-auto text-[10px] text-muted">Ctrl K</kbd>
          </button>
          <NavLink to="/review" className={railLink}>
            <span className="text-gold">✉</span> Weekly review
          </NavLink>
          <NavLink to="/settings" className={railLink}>
            <span
              className="inline-block h-3 w-3 rounded-full border border-edge"
              style={{ background: user?.color }}
            />
            {user?.display_name}
          </NavLink>
        </div>
      </aside>

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
            <ThemeMenu />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-2 md:pb-8">{children}</main>
      </div>

      {mobileBar}
      {cmdOpen && <CommandBar onClose={() => setCmdOpen(false)} />}
    </div>
  );
}
