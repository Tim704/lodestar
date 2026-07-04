// Focus — AI-planned focus sessions (CONTRACT §4.9, integration #8): plan the
// week (suggestions you confirm), run a goal + timer, check in what actually
// happened — and the logged time flows into course pace and the grade.

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { Link } from 'react-router-dom';
import type { Course, FocusPlanSuggestion, FocusSession, PrioritizedTask } from '@lodestar/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, ErrorNote, Modal, Spinner } from '../components/ui';

export default function FocusPage() {
  const [sessions, setSessions] = useState<FocusSession[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [tasks, setTasks] = useState<PrioritizedTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checkinFor, setCheckinFor] = useState<FocusSession | null>(null);
  const [checkedIn, setCheckedIn] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ sessions: FocusSession[] }>('/api/focus');
      setSessions(d.sessions);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    api.get<{ courses: Course[] }>('/api/study/courses').then((d) => setCourses(d.courses)).catch(() => {});
    api.get<{ tasks: PrioritizedTask[] }>('/api/tasks').then((d) => setTasks(d.tasks)).catch(() => {});
  }, [load]);

  const start = async (id: string) => {
    setError(null);
    try {
      await api.post(`/api/focus/${id}/start`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const abandon = async (id: string) => {
    await api.patch(`/api/focus/${id}`, { status: 'abandoned' });
    await load();
  };

  const remove = async (id: string) => {
    await api.del(`/api/focus/${id}`);
    await load();
  };

  if (!sessions) return <Spinner label="Gathering the week…" />;

  const active = sessions.find((s) => s.status === 'active') ?? null;
  const planned = sessions.filter((s) => s.status === 'planned');
  const history = sessions.filter((s) => s.status === 'done' || s.status === 'abandoned');

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="h-display mb-1 text-3xl">
        <span className="mr-1 text-m-study">◐</span>Focus
      </h1>
      <p className="mb-4 text-sm text-muted">
        One goal, one timer, one honest check-in — and the minutes land on your course pace
        automatically.
      </p>

      <ErrorNote error={error} />
      {checkedIn && (
        <div className="card-flat mb-3 border-m-habits px-3 py-2 text-sm text-m-habits">
          {checkedIn} <Link className="underline" to="/study">see the pace move →</Link>
        </div>
      )}

      {active && (
        <ActiveCard
          session={active}
          onCheckin={() => setCheckinFor(active)}
          onAbandon={() => void abandon(active.id)}
        />
      )}

      <PlanPanel courses={courses} onConfirmed={() => void load()} />
      <ManualAdd courses={courses} tasks={tasks} onAdded={() => void load()} />

      <h2 className="h-display mb-2 mt-6 text-lg">Planned</h2>
      {planned.length === 0 ? (
        <EmptyState icon="◐" title="Nothing planned" hint="Plan the week above, or add one manually." />
      ) : (
        <ul className="space-y-2">
          {planned.map((s) => (
            <li key={s.id} className="card-flat flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{s.goal}</span>
                <span className="ml-2 text-xs text-muted">
                  {s.planned_minutes}m
                  {s.course_name && ` · ${s.course_name}`}
                  {s.task_title && ` · ◈ ${s.task_title}`}
                  {s.planned_by === 'ai' && ' · ✦ planned'}
                </span>
              </span>
              {s.scheduled_for && (
                <span className="chip tnum" title="Scheduled">
                  {DateTime.fromISO(s.scheduled_for).toFormat('ccc d LLL HH:mm')}
                </span>
              )}
              <button className="btn-primary !px-2.5 !py-0.5 text-xs" onClick={() => void start(s.id)} disabled={Boolean(active)}>
                ▶ Start
              </button>
              <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => void remove(s.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <>
          <h2 className="h-display mb-2 mt-6 text-lg">History</h2>
          <ul className="space-y-1.5">
            {history.slice(0, 20).map((s) => (
              <li key={s.id} className="card-flat flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm opacity-80">
                <span className="min-w-0 flex-1">
                  <span className={s.status === 'abandoned' ? 'line-through' : ''}>{s.goal}</span>
                  {s.checkin_note && <span className="ml-2 text-xs italic text-muted">“{s.checkin_note}”</span>}
                </span>
                {s.status === 'done' ? (
                  <>
                    <span className="chip tnum">{s.actual_minutes}m / {s.planned_minutes}m</span>
                    <span
                      className={`chip tnum ${(s.completion_pct ?? 0) >= 80 ? 'border-m-habits text-m-habits' : ''}`}
                    >
                      {s.completion_pct}%
                    </span>
                  </>
                ) : (
                  <span className="chip">abandoned</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {checkinFor && (
        <CheckinModal
          session={checkinFor}
          onClose={() => setCheckinFor(null)}
          onDone={(msg) => {
            setCheckinFor(null);
            setCheckedIn(msg);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── active session: the countdown ────────────────────────────────────────────

function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function ActiveCard({
  session: s,
  onCheckin,
  onAbandon,
}: {
  session: FocusSession;
  onCheckin: () => void;
  onAbandon: () => void;
}) {
  const now = useNowTick();
  const elapsedSec = Math.max(0, Math.floor((now - new Date(s.started_at!).getTime()) / 1000));
  const remaining = s.planned_minutes * 60 - elapsedSec;
  const over = remaining < 0;
  const shown = Math.abs(remaining);
  const mm = Math.floor(shown / 60);
  const ss = String(shown % 60).padStart(2, '0');

  useEffect(() => {
    if (remaining === 0) {
      try {
        new Notification('◐ Focus time is up', { body: `${s.goal} — check in.` });
      } catch {
        /* not granted */
      }
    }
  }, [remaining, s.goal]);

  return (
    <div className="card mb-4 border-m-study p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-m-study">In session</div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="h-display text-xl">{s.goal}</div>
          <div className="text-xs text-muted">
            {s.course_name ?? 'no course'} · planned {s.planned_minutes}m
            {s.task_title && ` · ◈ ${s.task_title}`}
          </div>
        </div>
        <div className={`h-display tnum text-4xl ${over ? 'text-[#a13d2d]' : ''}`}>
          {over ? '+' : ''}
          {mm}:{ss}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" onClick={onCheckin}>
          ✓ Check in
        </button>
        <button className="btn-ghost" onClick={onAbandon} title="Stop without logging anything">
          Abandon
        </button>
      </div>
    </div>
  );
}

// ── check-in ─────────────────────────────────────────────────────────────────

function CheckinModal({
  session: s,
  onClose,
  onDone,
}: {
  session: FocusSession;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const elapsedMin = s.started_at
    ? Math.max(1, Math.round((Date.now() - new Date(s.started_at).getTime()) / 60_000))
    : s.planned_minutes;
  const [actual, setActual] = useState(Math.min(elapsedMin, 24 * 60));
  const [pct, setPct] = useState(100);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.post<{ study_session: unknown }>(`/api/focus/${s.id}/checkin`, {
        actual_minutes: actual,
        completion_pct: pct,
        note: note || null,
      });
      onDone(
        d.study_session
          ? `Checked in — ${actual}m logged to ${s.course_name ?? 'the course'}. ✦`
          : 'Checked in. ✦ (No course linked, so nothing was logged to Study.)',
      );
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Check in — ${s.goal}`} onClose={onClose}>
      <ErrorNote error={error} />
      <label className="label">Minutes actually worked</label>
      <input
        type="number"
        min={1}
        max={24 * 60}
        className="input mb-3"
        value={actual}
        onChange={(e) => setActual(Number(e.target.value))}
      />
      <label className="label">How much of the goal got done — {pct}%</label>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        className="mb-3 w-full"
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
      />
      <label className="label">Note (optional)</label>
      <input
        className="input mb-4"
        placeholder="got stuck on Q2, need office hours…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="btn-primary" onClick={() => void submit()} disabled={busy || actual < 1}>
        {busy ? '…' : s.course_id ? `Log ${actual}m to ${s.course_name ?? 'course'}` : 'Check in'}
      </button>
    </Modal>
  );
}

// ── plan the week ────────────────────────────────────────────────────────────

function PlanPanel({ courses, onConfirmed }: { courses: Course[]; onConfirmed: () => void }) {
  const [suggestions, setSuggestions] = useState<FocusPlanSuggestion[] | null>(null);
  const [generator, setGenerator] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.post<{ suggestions: FocusPlanSuggestion[]; generator: string }>(
        '/api/focus/plan',
        {},
      );
      setSuggestions(d.suggestions);
      setGenerator(d.generator);
      setPicked(new Set(d.suggestions.map((_, i) => i)));
      if (!d.suggestions.length) {
        setError('Nothing to plan — add tasks with due dates or fall behind somewhere first.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!suggestions) return;
    const chosen = suggestions
      .filter((_, i) => picked.has(i))
      .map((s) => ({
        task_id: s.task_id,
        course_id: s.course_id,
        goal: s.goal,
        planned_minutes: s.planned_minutes,
        scheduled_for: s.scheduled_for,
      }));
    if (!chosen.length) return;
    setBusy(true);
    try {
      await api.post('/api/focus/plan/confirm', { suggestions: chosen });
      setSuggestions(null);
      onConfirmed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mb-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="h-display text-lg">Plan the week</h2>
          <p className="text-xs text-muted">
            Deadlines + pace deficits + lecture gaps → proposed sessions. You confirm; nothing is
            created behind your back.
          </p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => void plan()} disabled={busy}>
          {busy && !suggestions ? 'Planning…' : '✦ Plan my week'}
        </button>
      </div>
      <ErrorNote error={error} />
      {suggestions && suggestions.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-2 text-xs text-muted">
            proposed by {generator === 'gemini' ? 'the bureau clerk (Gemini)' : 'the heuristic planner'} —
            untick anything wrong:
          </div>
          {suggestions.map((s, i) => (
            <label key={i} className="mb-1.5 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.has(i)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setPicked(next);
                }}
              />
              <span className="min-w-0">
                <span className="font-semibold">{s.goal}</span>
                <span className="ml-1.5 text-xs text-muted">
                  {s.planned_minutes}m
                  {s.scheduled_for &&
                    ` · ${DateTime.fromISO(s.scheduled_for).toFormat('ccc d LLL HH:mm')}`}
                  {s.course_name && ` · ${s.course_name}`}
                  {s.reason && ` — ${s.reason}`}
                </span>
              </span>
            </label>
          ))}
          <button className="btn-primary mt-2" onClick={() => void confirm()} disabled={busy || picked.size === 0}>
            Confirm {picked.size} session{picked.size === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── manual add ───────────────────────────────────────────────────────────────

function ManualAdd({
  courses,
  tasks,
  onAdded,
}: {
  courses: Course[];
  tasks: PrioritizedTask[];
  onAdded: () => void;
}) {
  const { user } = useAuth();
  const [goal, setGoal] = useState('');
  const [minutes, setMinutes] = useState(50);
  const [courseId, setCourseId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    try {
      await api.post('/api/focus', {
        goal,
        planned_minutes: minutes,
        course_id: courseId || null,
        task_id: taskId || null,
        scheduled_for: when
          ? DateTime.fromISO(when, { zone: user!.tz }).toUTC().toISO()
          : null,
      });
      setGoal('');
      setWhen('');
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="card-flat p-3">
      <div className="label">Manual session</div>
      <ErrorNote error={error} />
      <div className="flex flex-wrap items-end gap-2">
        <input
          className="input min-w-40 flex-1"
          placeholder='Goal — "Questions 1–3", "Read ch. 4"…'
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
        <input
          type="number"
          min={5}
          max={600}
          step={5}
          className="input !w-20"
          title="planned minutes"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
        />
        <select
          className="input !w-auto"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          title="Course (check-in logs the time here)"
        >
          <option value="">no course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          className="input max-w-44 !w-auto"
          value={taskId}
          onChange={(e) => {
            setTaskId(e.target.value);
            const t = tasks.find((x) => x.id === e.target.value);
            if (t?.course_id) setCourseId(t.course_id); // task's course drives the study log
            if (t && !goal) setGoal(t.title);
          }}
          title="Linked task (its cognitive load becomes the session effort)"
        >
          <option value="">no task</option>
          {tasks.slice(0, 20).map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
        <input
          type="datetime-local"
          className="input !w-auto"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <button className="btn-ghost" onClick={() => void add()} disabled={!goal.trim()}>
          + Add
        </button>
      </div>
    </div>
  );
}
