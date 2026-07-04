// Projects — the vibe-coded project manager (CONTRACT §4.12): ideas for the
// future, what's active now, and where everything stands. Deliberately
// lightweight — a status board, not Jira.

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import type { Project, ProjectStatus, ProjectSuggestion, Task } from '@lodestar/shared';
import { api } from '../api';
import { EmptyState, ErrorNote, Modal, Spinner } from '../components/ui';

const COLUMNS: Array<{ status: ProjectStatus; label: string; hint: string }> = [
  { status: 'idea', label: 'Ideas', hint: 'the dumping ground' },
  { status: 'active', label: 'Active', hint: 'in motion' },
  { status: 'paused', label: 'Paused', hint: 'on ice, on purpose' },
  { status: 'shipped', label: 'Shipped', hint: 'out in the world' },
  { status: 'shelved', label: 'Shelved', hint: 'let go' },
];

const externalHref = (v: string) => (v.startsWith('http') ? v : `https://${v}`);

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idea, setIdea] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ projects: Project[] }>('/api/projects');
      setProjects(d.projects);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const quickAddIdea = async () => {
    if (!idea.trim()) return;
    await api.post('/api/projects', { name: idea.trim(), status: 'idea' });
    setIdea('');
    await load();
  };

  const setStatus = async (p: Project, status: ProjectStatus) => {
    await api.patch(`/api/projects/${p.id}`, { status });
    await load();
  };

  const togglePin = async (p: Project) => {
    await api.patch(`/api/projects/${p.id}`, { pinned: !p.pinned });
    await load();
  };

  if (!projects) return <Spinner label="Surveying the workshop…" />;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="h-display mb-1 text-3xl">
        <span className="mr-1 text-m-projects">⚑</span>Projects
      </h1>
      <p className="mb-4 text-sm text-muted">
        Every side project, from shower-thought to shipped. Tasks added here flow into the order
        of execution and the fortnight.
      </p>

      <ErrorNote error={error} />

      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="flex items-start gap-3" style={{ minWidth: 'max-content' }}>
          {COLUMNS.map((col) => {
            const items = projects.filter((p) => p.status === col.status);
            return (
              <section key={col.status} className="w-64 flex-none">
                <div className="mb-2 flex items-baseline justify-between px-0.5">
                  <h2 className="h-display text-lg">{col.label}</h2>
                  <span className="tnum text-xs text-muted">
                    {items.length} · {col.hint}
                  </span>
                </div>

                {col.status === 'idea' && (
                  <div className="mb-2 flex gap-1.5">
                    <input
                      className="input !py-1 text-xs"
                      placeholder="new idea…"
                      value={idea}
                      onChange={(e) => setIdea(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void quickAddIdea();
                      }}
                    />
                    <button
                      className="btn-primary !px-2 !py-1 text-xs"
                      onClick={() => void quickAddIdea()}
                      disabled={!idea.trim()}
                    >
                      +
                    </button>
                  </div>
                )}

                <div className="space-y-2.5">
                  {items.length === 0 && col.status !== 'idea' && (
                    <div className="card-flat border-dashed p-3 text-center text-xs text-muted">
                      empty
                    </div>
                  )}
                  {items.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      expanded={expanded === p.id}
                      onExpand={() => setExpanded(expanded === p.id ? null : p.id)}
                      onStatus={(s) => void setStatus(p, s)}
                      onPin={() => void togglePin(p)}
                      onEdit={() => setEditing(p)}
                      onChanged={() => void load()}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {projects.length === 0 && (
        <EmptyState
          icon="⚑"
          title="No projects yet"
          hint='Drop the first idea into the Ideas column — "rebuild my portfolio", "tiny game", anything.'
        />
      )}

      {editing && (
        <EditModal
          project={editing}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({
  project: p,
  expanded,
  onExpand,
  onStatus,
  onPin,
  onEdit,
  onChanged,
}: {
  project: Project;
  expanded: boolean;
  onExpand: () => void;
  onStatus: (s: ProjectStatus) => void;
  onPin: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const touched = DateTime.fromISO(p.updated_at).toRelative({ style: 'narrow' });

  return (
    <div className="card p-3" style={p.color ? { borderColor: p.color } : undefined}>
      <div className="flex items-start gap-1.5">
        <button
          className={`flex-none text-sm ${p.pinned ? 'text-gold' : 'text-line hover:text-gold'}`}
          title={p.pinned ? 'Unpin' : 'Pin to top'}
          onClick={onPin}
        >
          ✦
        </button>
        <button className="h-display min-w-0 flex-1 truncate text-left text-base hover:underline" onClick={onExpand}>
          {p.name}
        </button>
        <button className="flex-none text-xs text-muted hover:text-ink" title="Edit" onClick={onEdit}>
          ✎
        </button>
      </div>

      {p.blurb && <p className="mt-1 text-xs text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{p.blurb}</p>}
      {p.next_action && (
        <p className="mt-1 truncate text-xs">
          <span className="text-m-projects">→</span> {p.next_action}
        </p>
      )}

      {p.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {p.tags.map((t) => (
            <span key={t} className="chip !px-1 !text-[9px]">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        {(p.open_tasks ?? 0) > 0 && (
          <span className="chip border-m-tasks text-m-tasks">◈ {p.open_tasks}</span>
        )}
        {p.repo_url && (
          <a className="underline" href={externalHref(p.repo_url)} target="_blank" rel="noreferrer">
            repo↗
          </a>
        )}
        {p.live_url && (
          <a className="underline" href={externalHref(p.live_url)} target="_blank" rel="noreferrer">
            live↗
          </a>
        )}
        <span className="tnum ml-auto" title={`last touched ${p.updated_at}`}>
          {touched}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <select
          className="input !w-auto !px-1.5 !py-0.5 text-xs"
          value={p.status}
          onChange={(e) => onStatus(e.target.value as ProjectStatus)}
          aria-label={`Status of ${p.name}`}
        >
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {c.label}
            </option>
          ))}
        </select>
        {p.status === 'idea' && (
          <button className="btn-primary !px-2 !py-0.5 text-xs" onClick={() => onStatus('active')}>
            Promote ▶
          </button>
        )}
      </div>

      {expanded && <ProjectTasks project={p} onChanged={onChanged} />}
    </div>
  );
}

function ProjectTasks({ project: p, onChanged }: { project: Project; onChanged: () => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState('');
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ tasks: Task[] }>(`/api/projects/${p.id}/tasks`);
      setTasks(d.tasks);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [p.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!title.trim()) return;
    await api.post(`/api/projects/${p.id}/tasks`, { title: title.trim() });
    setTitle('');
    await load();
    onChanged();
  };

  const toggle = async (id: string) => {
    await api.post(`/api/tasks/${id}/toggle`);
    await load();
    onChanged();
  };

  const suggest = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.post<{ suggestions: ProjectSuggestion[] }>(`/api/projects/${p.id}/suggest`);
      setSuggestions(d.suggestions);
      setPicked(new Set(d.suggestions.map((_, i) => i)));
      if (!d.suggestions.length) setError('No fresh steps to suggest.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!suggestions) return;
    const titles = suggestions.filter((_, i) => picked.has(i)).map((s) => s.title);
    if (!titles.length) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${p.id}/suggest/confirm`, { titles });
      setSuggestions(null);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = (tasks ?? []).filter((t) => !t.is_completed);
  const done = (tasks ?? []).filter((t) => t.is_completed).slice(0, 5);

  return (
    <div className="mt-2 border-t border-line pt-2">
      <ErrorNote error={error} />
      {!tasks ? (
        <div className="text-xs text-muted">loading…</div>
      ) : (
        <>
          {open.map((t) => (
            <div key={t.id} className="mb-1 flex items-center gap-1.5 text-xs">
              <button
                className="h-3.5 w-3.5 flex-none border-2 border-edge hover:bg-gold"
                title="Done"
                onClick={() => void toggle(t.id)}
              />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="tnum flex-none text-muted">~{t.duration_min}m</span>
            </div>
          ))}
          {done.map((t) => (
            <div key={t.id} className="mb-1 flex items-center gap-1.5 text-xs text-muted">
              <button className="h-3.5 w-3.5 flex-none border-2 border-edge bg-gold" title="Reopen" onClick={() => void toggle(t.id)} />
              <span className="min-w-0 flex-1 truncate line-through">{t.title}</span>
            </div>
          ))}
          {open.length === 0 && done.length === 0 && (
            <div className="mb-1 text-xs text-muted">No tasks yet.</div>
          )}
        </>
      )}

      <div className="mt-1.5 flex gap-1.5">
        <input
          className="input !py-1 text-xs"
          placeholder="add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void add()} disabled={!title.trim()}>
          +
        </button>
      </div>

      {suggestions ? (
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-muted">untick anything wrong, then create:</div>
          {suggestions.map((s, i) => (
            <label key={i} className="mb-1 flex items-start gap-1.5 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={picked.has(i)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setPicked(next);
                }}
              />
              <span>
                <span className="font-semibold">{s.title}</span>
                {s.reason && <span className="text-muted"> — {s.reason}</span>}
              </span>
            </label>
          ))}
          <button className="btn-primary mt-1 !px-2 !py-0.5 text-xs" onClick={() => void confirm()} disabled={busy || picked.size === 0}>
            Create {picked.size}
          </button>
        </div>
      ) : (
        <button className="btn-ghost mt-1.5 !px-2 !py-0.5 text-xs" onClick={() => void suggest()} disabled={busy}>
          {busy ? '…' : '✦ suggest next steps'}
        </button>
      )}
    </div>
  );
}

function EditModal({
  project: p,
  onClose,
  onChanged,
}: {
  project: Project;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState({
    name: p.name,
    blurb: p.blurb ?? '',
    next_action: p.next_action ?? '',
    repo_url: p.repo_url ?? '',
    live_url: p.live_url ?? '',
    color: p.color ?? '',
    tags: p.tags.join(', '),
  });
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError(null);
    try {
      await api.patch(`/api/projects/${p.id}`, {
        name: form.name,
        blurb: form.blurb || null,
        next_action: form.next_action || null,
        repo_url: form.repo_url || null,
        live_url: form.live_url || null,
        color: form.color || null,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 12),
      });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title={`Edit ${p.name}`} onClose={onClose}>
      <ErrorNote error={error} />
      <label className="label">Name</label>
      <input className="input mb-3" value={form.name} onChange={(e) => set('name', e.target.value)} />
      <label className="label">Blurb — what is this?</label>
      <textarea
        className="input mb-3 min-h-[60px] resize-y"
        value={form.blurb}
        onChange={(e) => set('blurb', e.target.value)}
        placeholder="the vibe, the goal, the itch it scratches…"
      />
      <label className="label">Next action</label>
      <input
        className="input mb-3"
        value={form.next_action}
        onChange={(e) => set('next_action', e.target.value)}
        placeholder="the one very next step"
      />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label>
          <span className="label">Repo</span>
          <input className="input" value={form.repo_url} onChange={(e) => set('repo_url', e.target.value)} placeholder="github.com/…" />
        </label>
        <label>
          <span className="label">Live URL</span>
          <input className="input" value={form.live_url} onChange={(e) => set('live_url', e.target.value)} placeholder="something.timhufnagel.org" />
        </label>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label>
          <span className="label">Tags (comma-sep)</span>
          <input className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="web, ai, uni" />
        </label>
        <label>
          <span className="label">Card colour</span>
          <input
            type="color"
            className="input h-9 !p-0.5"
            value={form.color || '#8a4f7d'}
            onChange={(e) => set('color', e.target.value)}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={() => void save()} disabled={!form.name.trim()}>
          Save
        </button>
        <button
          className="btn-danger"
          onClick={() => {
            if (confirm(`Delete "${p.name}"? Its tasks stay, unlinked.`)) {
              void api.del(`/api/projects/${p.id}`).then(onChanged);
            }
          }}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}
