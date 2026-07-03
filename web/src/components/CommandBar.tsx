// Ctrl-K command bar: global search across every module, and natural-language
// capture (integration #6) — prefix with "+" to capture ("+ email prof by
// friday, important"), then confirm the suggestions the assistant proposes.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CaptureSuggestion, SearchResults } from '@lodestar/shared';
import { api } from '../api';
import { Spinner } from './ui';

export function CommandBar({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [suggestions, setSuggestions] = useState<CaptureSuggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const isCapture = q.startsWith('+');

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // live search (not in capture mode)
  useEffect(() => {
    setSuggestions(null);
    setDone(null);
    setError(null);
    if (isCapture || q.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .get<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then(setResults)
        .catch(() => setResults(null));
    }, 250);
    return () => clearTimeout(t);
  }, [q, isCapture]);

  const runCapture = async () => {
    const text = q.replace(/^\+\s*/, '').trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<{ suggestions: CaptureSuggestion[] }>('/api/assistant/capture', {
        text,
      });
      setSuggestions(data.suggestions);
      setPicked(new Set(data.suggestions.map((_, i) => i)));
      if (!data.suggestions.length) setError('Nothing actionable found in that.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmCapture = async () => {
    if (!suggestions) return;
    const chosen = suggestions.filter((_, i) => picked.has(i));
    if (!chosen.length) return;
    setBusy(true);
    try {
      const res = await api.post<{ created: Array<{ kind: string }> }>(
        '/api/assistant/capture/confirm',
        { suggestions: chosen },
      );
      setDone(`Filed ${res.created.length} item${res.created.length === 1 ? '' : 's'}. ✦`);
      setSuggestions(null);
      setQ('');
      setTimeout(onClose, 900);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const section = (title: string, rows: Array<{ key: string; label: string; path: string; sub?: string }>) =>
    rows.length ? (
      <div key={title}>
        <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          {title}
        </div>
        {rows.map((r) => (
          <button
            key={r.key}
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-paper"
            onClick={() => go(r.path)}
          >
            {r.label}
            {r.sub && <span className="ml-2 text-xs text-muted">{r.sub}</span>}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-xl">
        <div className="flex items-center gap-2 border-b-2 border-ink px-3 py-2">
          <span className="text-gold">{isCapture ? '＋' : '⌘'}</span>
          <input
            ref={inputRef}
            className="w-full bg-transparent text-sm focus:outline-none"
            placeholder="Search everything… or start with + to capture (&quot;+ email prof by friday&quot;)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isCapture && !suggestions) void runCapture();
            }}
          />
          {isCapture && !suggestions && (
            <button className="btn-primary !py-0.5 text-xs" onClick={() => void runCapture()} disabled={busy}>
              Capture
            </button>
          )}
        </div>

        <div className="max-h-[50vh] overflow-y-auto pb-2">
          {busy && <Spinner label={isCapture ? 'Consulting the bureau…' : undefined} />}
          {error && <div className="px-3 py-2 text-sm text-[#a13d2d]">{error}</div>}
          {done && <div className="px-3 py-2 text-sm text-m-habits">{done}</div>}

          {suggestions && (
            <div className="p-3">
              <div className="mb-2 text-xs text-muted">
                The assistant proposes — untick anything wrong, then file:
              </div>
              {suggestions.map((s, i) => (
                <label key={i} className="mb-1 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.has(i)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setPicked(next);
                    }}
                  />
                  <span className="chip">{s.kind}</span>
                  {s.label}
                </label>
              ))}
              <button className="btn-primary mt-2" onClick={() => void confirmCapture()} disabled={busy}>
                File {picked.size} item{picked.size === 1 ? '' : 's'}
              </button>
            </div>
          )}

          {results && !isCapture && (
            <>
              {section(
                'Tasks',
                results.tasks.map((t) => ({
                  key: t.id,
                  label: t.title,
                  path: '/tasks',
                  sub: t.is_completed ? 'done' : undefined,
                })),
              )}
              {section(
                'Events',
                results.events.map((e) => ({
                  key: e.id,
                  label: e.title,
                  path: '/calendar',
                  sub: (e.start_date ?? e.start_utc?.slice(0, 10)) ?? undefined,
                })),
              )}
              {section(
                'Notes',
                results.notes.map((n) => ({
                  key: n.note_id,
                  label: n.title || n.snippet.slice(0, 60) || '(untitled note)',
                  path: '/notes',
                })),
              )}
              {section(
                'Backlog',
                results.media.map((m) => ({
                  key: m.id,
                  label: m.title,
                  path: '/backlog',
                  sub: m.domain,
                })),
              )}
              {section(
                'Courses',
                results.courses.map((c) => ({ key: c.id, label: c.name, path: '/study' })),
              )}
              {!results.tasks.length &&
                !results.events.length &&
                !results.notes.length &&
                !results.media.length &&
                !results.courses.length && (
                  <div className="px-3 py-3 text-sm text-muted">Nothing found for “{q.trim()}”.</div>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
