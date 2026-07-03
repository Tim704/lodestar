// Watchers — checkRosenberg generalized: watch any page for new items,
// get pushed, optionally spawn a task (integration #4).

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import type { Watcher, WatcherHit } from '@lodestar/shared';
import { api } from '../api';
import { EmptyState, ErrorNote, Modal, Spinner } from '../components/ui';

export default function WatchersPage() {
  const [watchers, setWatchers] = useState<Watcher[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Watcher | 'new' | null>(null);
  const [hitsFor, setHitsFor] = useState<Watcher | null>(null);
  const [runBusy, setRunBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ watchers: Watcher[] }>('/api/watchers');
      setWatchers(d.watchers);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runNow = async (w: Watcher) => {
    setRunBusy(w.id);
    setError(null);
    try {
      const d = await api.post<{ result: { ok: boolean; error?: string; found: number; new_items: string[] } }>(
        `/api/watchers/${w.id}/run`,
      );
      if (!d.result.ok) setError(`${w.name}: ${d.result.error}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="h-display text-3xl">
          <span className="mr-1 text-m-watchers">◉</span>Watchers
        </h1>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          + Watcher
        </button>
      </div>
      <p className="mb-4 text-sm text-muted">
        Point one at any page — apartment lists, course seats, grade boards. New items push a
        notification and can spawn a task. (Static pages only; no headless browser on the Pi.)
      </p>

      <ErrorNote error={error} />

      {!watchers ? (
        <Spinner />
      ) : watchers.length === 0 ? (
        <EmptyState
          icon="◉"
          title="Nothing under surveillance"
          hint='Try one: name "Apartments", a URL, CSS mode with selector "table tbody tr", exclude pattern "Belegt".'
        />
      ) : (
        <ul className="space-y-2">
          {watchers.map((w) => (
            <li key={w.id} className="card-flat p-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={`h-3 w-3 rounded-full border border-ink ${w.active ? 'bg-m-habits' : 'bg-line'}`}
                  title={w.active ? 'Active — click to pause' : 'Paused — click to resume'}
                  onClick={() => void api.patch(`/api/watchers/${w.id}`, { active: !w.active }).then(load)}
                />
                <span className="font-semibold">{w.name}</span>
                <a
                  href={w.url}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-52 truncate text-xs text-muted underline"
                >
                  {w.url.replace(/^https?:\/\//, '')}
                </a>
                <span className="chip">{w.mode}</span>
                <span className="chip">every {w.interval_min}m</span>
                {w.create_task && <span className="chip border-m-tasks text-m-tasks">→ task</span>}
                <span className="ml-auto text-xs text-muted">
                  {w.last_run_at
                    ? `ran ${DateTime.fromISO(w.last_run_at).toRelative({ style: 'narrow' })}`
                    : 'never ran'}
                  {w.last_status === 'error' && (
                    <span className="ml-1 text-[#a13d2d]" title={w.last_error ?? ''}>⚠</span>
                  )}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <code className="max-w-full truncate rounded-sm border border-line bg-paper px-1.5 py-0.5">
                  {w.selector}
                </code>
                {w.exclude_pattern && (
                  <code className="rounded-sm border border-line bg-paper px-1.5 py-0.5 line-through">
                    {w.exclude_pattern}
                  </code>
                )}
                <span className="text-muted">{w.known_count} known</span>
                <span className="ml-auto flex gap-1.5">
                  <button
                    className="btn-ghost !px-2 !py-0.5"
                    disabled={runBusy === w.id}
                    onClick={() => void runNow(w)}
                  >
                    {runBusy === w.id ? '…' : 'run now'}
                  </button>
                  <button className="btn-ghost !px-2 !py-0.5" onClick={() => setHitsFor(w)}>
                    hits
                  </button>
                  <button className="btn-ghost !px-2 !py-0.5" onClick={() => setEditing(w)}>
                    edit
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <WatcherModal
          watcher={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {hitsFor && <HitsModal watcher={hitsFor} onClose={() => setHitsFor(null)} />}
    </div>
  );
}

function WatcherModal({
  watcher,
  onClose,
  onChanged,
}: {
  watcher: Watcher | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState({
    name: watcher?.name ?? '',
    url: watcher?.url ?? '',
    mode: watcher?.mode ?? ('css' as 'css' | 'regex'),
    selector: watcher?.selector ?? '',
    exclude_pattern: watcher?.exclude_pattern ?? '',
    interval_min: watcher?.interval_min ?? 30,
    create_task: watcher?.create_task ?? false,
    task_hint: watcher?.task_hint ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError(null);
    const body = {
      ...form,
      exclude_pattern: form.exclude_pattern || null,
      task_hint: form.task_hint || null,
    };
    try {
      if (watcher) await api.patch(`/api/watchers/${watcher.id}`, body);
      else await api.post('/api/watchers', body);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title={watcher ? `Edit ${watcher.name}` : 'New watcher'} onClose={onClose} wide>
      <ErrorNote error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">Name</span>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </label>
        <label>
          <span className="label">Check every (min)</span>
          <input
            type="number"
            min={5}
            className="input"
            value={form.interval_min}
            onChange={(e) => set('interval_min', Number(e.target.value))}
          />
        </label>
        <label className="sm:col-span-2">
          <span className="label">URL</span>
          <input className="input" value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" />
        </label>
        <label>
          <span className="label">Mode</span>
          <select className="input" value={form.mode} onChange={(e) => set('mode', e.target.value as 'css' | 'regex')}>
            <option value="css">CSS selector (each match = one item)</option>
            <option value="regex">Regex (group 1 or full match)</option>
          </select>
        </label>
        <label>
          <span className="label">{form.mode === 'css' ? 'Selector' : 'Pattern'}</span>
          <input
            className="input font-mono text-xs"
            value={form.selector}
            onChange={(e) => set('selector', e.target.value)}
            placeholder={form.mode === 'css' ? 'table tbody tr' : 'Apartment ([\\d.]+)'}
          />
        </label>
        <label>
          <span className="label">Exclude pattern (regex, optional)</span>
          <input
            className="input font-mono text-xs"
            value={form.exclude_pattern}
            onChange={(e) => set('exclude_pattern', e.target.value)}
            placeholder="Belegt"
          />
        </label>
        <div className="flex flex-col justify-end gap-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.create_task}
              onChange={(e) => set('create_task', e.target.checked)}
            />
            spawn a task on new hits
          </label>
          {form.create_task && (
            <input
              className="input"
              value={form.task_hint}
              onChange={(e) => set('task_hint', e.target.value)}
              placeholder='task prefix, e.g. "Apply for apartment"'
            />
          )}
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          className="btn-primary"
          onClick={() => void save()}
          disabled={!form.name.trim() || !form.url.trim() || !form.selector.trim()}
        >
          Save
        </button>
        {watcher && (
          <button
            className="btn-danger"
            onClick={() => {
              if (confirm(`Delete watcher "${watcher.name}"?`)) {
                void api.del(`/api/watchers/${watcher.id}`).then(onChanged);
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
    </Modal>
  );
}

function HitsModal({ watcher, onClose }: { watcher: Watcher; onClose: () => void }) {
  const [hits, setHits] = useState<WatcherHit[] | null>(null);

  useEffect(() => {
    api
      .get<{ hits: WatcherHit[] }>(`/api/watchers/${watcher.id}/hits`)
      .then((d) => setHits(d.hits))
      .catch(() => setHits([]));
  }, [watcher.id]);

  return (
    <Modal title={`${watcher.name} — hits`} onClose={onClose}>
      {!hits ? (
        <Spinner />
      ) : hits.length === 0 ? (
        <p className="text-sm text-muted">No hits yet. The watch continues.</p>
      ) : (
        <ul className="space-y-1.5">
          {hits.map((h) => (
            <li key={h.id} className="card-flat px-3 py-1.5 text-sm">
              <span className="tnum mr-2 text-xs text-muted">
                {DateTime.fromISO(h.seen_at).toFormat('d LLL HH:mm')}
              </span>
              {h.item}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
