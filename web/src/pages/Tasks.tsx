// Tasks — the dynamic to-do port: smart-add (Gemini scores everything),
// the order of execution, and the between-lectures quick-win filter.

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import type { Course, GapInfo, PrioritizedTask } from '@lodestar/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, ErrorNote, Spinner, loadDots } from '../components/ui';

export default function TasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<PrioritizedTask[] | null>(null);
  const [gaps, setGaps] = useState<GapInfo[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [input, setInput] = useState('');
  const [betweenLectures, setBetweenLectures] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (betweenLectures || showDone) {
        const params = new URLSearchParams();
        if (betweenLectures) params.set('between_lectures', 'true');
        if (showDone) params.set('include_completed', 'true');
        const data = await api.get<{ tasks: PrioritizedTask[] }>(`/api/tasks?${params}`);
        setTasks(data.tasks);
        setGaps([]);
      } else {
        const data = await api.get<{ tasks: PrioritizedTask[]; gaps: GapInfo[] }>('/api/tasks/plan');
        setTasks(data.tasks);
        setGaps(data.gaps);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [betweenLectures, showDone]);

  useEffect(() => {
    void load();
    api.get<{ courses: Course[] }>('/api/study/courses').then((d) => setCourses(d.courses)).catch(() => {});
  }, [load]);

  const smartAdd = async () => {
    const names = input
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/tasks/smart-add', { task_names: names.slice(0, 20) });
      setInput('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string) => {
    await api.post(`/api/tasks/${id}/toggle`);
    void load();
  };

  const remove = async (id: string) => {
    await api.del(`/api/tasks/${id}`);
    void load();
  };

  const setDue = async (id: string, value: string) => {
    const due_at = value ? DateTime.fromISO(value, { zone: user!.tz }).toUTC().toISO() : null;
    await api.patch(`/api/tasks/${id}`, { due_at });
    void load();
  };

  const setCourse = async (id: string, courseId: string) => {
    await api.patch(`/api/tasks/${id}`, { course_id: courseId || null });
    void load();
  };

  const sourceIcon: Record<string, string> = {
    manual: '',
    capture: '＋',
    note: '❏',
    watcher: '◉',
    study: '△',
    project: '⚑',
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="h-display mb-1 text-3xl">
        <span className="mr-1 text-m-tasks">◈</span>Tasks
      </h1>
      <p className="mb-4 text-sm text-muted">
        Type them in — {`the engine scores cognitive load, urgency and minutes, then hands back the order of execution.`}
      </p>

      <ErrorNote error={error} />

      <div className="card mb-4 p-3">
        <textarea
          className="input min-h-[70px] resize-y"
          placeholder={'One task per line…\nfinish linear algebra sheet\nbook dentist\nemail prof about thesis'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void smartAdd();
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted">Ctrl-Enter to file · Gemini scores each line</span>
          <button className="btn-primary" onClick={() => void smartAdd()} disabled={busy || !input.trim()}>
            {busy ? 'Scoring…' : 'Smart add'}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          className={`chip cursor-pointer ${betweenLectures ? 'bg-m-tasks text-white' : ''}`}
          onClick={() => setBetweenLectures((v) => !v)}
          title="≤30 min and low cognitive load"
        >
          ⧖ between lectures
        </button>
        <button
          className={`chip cursor-pointer ${showDone ? 'bg-ink text-paper' : ''}`}
          onClick={() => setShowDone((v) => !v)}
        >
          show done
        </button>
        {gaps.length > 0 && (
          <span className="ml-auto text-xs text-muted">
            today's gaps: {gaps.map((g) => `${g.start} (${g.minutes}m)`).join(' · ')}
          </span>
        )}
      </div>

      {!tasks ? (
        <Spinner />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon="◈"
          title={betweenLectures ? 'No quick wins on the shelf' : 'The slate is clean'}
          hint={betweenLectures ? 'Nothing under 30 minutes and low load right now.' : 'Add a few lines above.'}
        />
      ) : (
        <ol className="space-y-2">
          {tasks.map((t, i) => (
            <li key={t.id} className={`card-flat p-3 ${t.is_completed ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-2.5">
                <button
                  className={`mt-0.5 h-5 w-5 shrink-0 border-2 border-ink ${t.is_completed ? 'bg-gold' : 'hover:bg-[color:color-mix(in_srgb,var(--accent)_40%,transparent)]'}`}
                  onClick={() => void toggle(t.id)}
                  title={t.is_completed ? 'Reopen' : 'Done'}
                >
                  {t.is_completed ? '✓' : ''}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="tnum text-xs text-muted">{i + 1}.</span>
                    <span className={`font-semibold ${t.is_completed ? 'line-through' : ''}`}>
                      {sourceIcon[t.source] && <span className="mr-1 text-muted">{sourceIcon[t.source]}</span>}
                      {t.title}
                    </span>
                    <span className="text-xs text-muted">
                      imp {t.importance} · load {loadDots(t.cognitive_load)} · ~{t.duration_min}m · S={t.priority_score.toFixed(1)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    {t.deadline_bucket !== 'none' && (
                      <span className="chip border-[#a13d2d] text-[#a13d2d]">
                        {t.deadline_bucket === 'overdue'
                          ? 'overdue'
                          : `due ${DateTime.fromISO(t.due_at!).setZone(user!.tz).toFormat('d LLL HH:mm')}`}
                      </span>
                    )}
                    {t.fits_gap && (
                      <span className="chip border-m-tasks text-m-tasks">
                        fits the {t.fits_gap.start} gap ({t.fits_gap.minutes}m)
                      </span>
                    )}
                    {t.is_starving && !t.is_completed && (
                      <span className="chip" title="Untouched for over a week">starving</span>
                    )}
                    {t.urgency_multiplier > 1 && (
                      <span className="chip border-gold text-gold" title="Academic keyword or deadline boost">
                        ×{t.urgency_multiplier.toFixed(1)}
                      </span>
                    )}
                    {t.reasoning && <span className="text-muted">— {t.reasoning}</span>}
                  </div>
                  {expanded === t.id && (
                    <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-line pt-2">
                      <label className="text-xs">
                        <span className="label">Due</span>
                        <input
                          type="datetime-local"
                          className="input !w-auto"
                          defaultValue={
                            t.due_at
                              ? DateTime.fromISO(t.due_at).setZone(user!.tz).toFormat("yyyy-MM-dd'T'HH:mm")
                              : ''
                          }
                          onChange={(e) => void setDue(t.id, e.target.value)}
                        />
                      </label>
                      <label className="text-xs">
                        <span className="label">Course</span>
                        <select
                          className="input !w-auto"
                          defaultValue={t.course_id ?? ''}
                          onChange={(e) => void setCourse(t.id, e.target.value)}
                        >
                          <option value="">—</option>
                          {courses.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                      <button className="btn-danger !py-1 text-xs" onClick={() => void remove(t.id)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className="btn-ghost tap !px-2 !py-0.5 text-xs"
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                >
                  {expanded === t.id ? '▴' : '▾'}
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
