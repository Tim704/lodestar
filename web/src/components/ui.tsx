// Tiny UI kit for the Night Almanac system — everything else is Tailwind
// classes defined in styles.css (.card, .btn, .chip, …).

import { useEffect } from 'react';
import type { ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // §8.4: bottom sheet below `sm`, centered dialog above it
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-start sm:p-4 sm:pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card sheet-in w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[85dvh] overflow-y-auto overscroll-contain rounded-b-none pb-[env(safe-area-inset-bottom)] sm:max-h-[80vh] sm:rounded-b-[var(--radius)] sm:pb-0`}
      >
        <div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2.5">
          <h2 className="h-display text-lg">{title}</h2>
          <button className="btn-ghost tap !px-2 !py-0.5" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="card-flat border-dashed p-8 text-center text-muted">
      <div className="mb-2 text-3xl">{icon}</div>
      <div className="h-display text-lg text-ink">{title}</div>
      {hint && <div className="mt-1 text-sm">{hint}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-muted">
      <span className="inline-block animate-spin">✦</span>
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="card-flat px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="h-display tnum text-xl">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Meter({ pct, tone }: { pct: number; tone?: 'ok' | 'warn' }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2.5 w-full border border-ink bg-paper">
      <div
        className={tone === 'warn' ? 'h-full bg-[#a13d2d]' : 'h-full bg-m-habits'}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Minimal markdown for telegrams: paragraphs, **bold**, - and 1. lists. */
export function Telegram({ md }: { md: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>);
    blocks.push(list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
    list = null;
  };

  const inline = (text: string): ReactNode[] => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p,
    );
  };

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const ul = line.match(/^[-*]\s+(.*)/);
    const ol = line.match(/^\d+\.\s+(.*)/);
    if (ul) {
      if (!list || list.ordered) {
        flush();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]!);
    } else if (ol) {
      if (!list || !list.ordered) {
        flush();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]!);
    } else {
      flush();
      if (line.trim()) blocks.push(<p key={key++}>{inline(line.replace(/^#+\s*/, ''))}</p>);
    }
  }
  flush();
  return <div className="telegram text-sm leading-relaxed">{blocks}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="card-flat mb-3 border-[#a13d2d] bg-[#a13d2d]/10 px-3 py-2 text-sm text-[#a13d2d]">
      {error}
    </div>
  );
}

export const LOAD_DOTS = ['·', '··', '···', '····', '·····'];

export function loadDots(load: number): string {
  return LOAD_DOTS[Math.max(1, Math.min(5, load)) - 1]!;
}
