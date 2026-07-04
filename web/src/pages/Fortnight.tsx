// Fortnight — the home page (CONTRACT §4.11): the next two weeks of classes,
// due dates, and events at a glance. Two stacked calendar weeks on desktop,
// a vertical agenda on mobile. `/calendar` remains the full planner.

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { Link, useNavigate } from 'react-router-dom';
import { addDaysStr, mondayOf, type FortnightDay, type FortnightPayload } from '@lodestar/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, ErrorNote, Modal, Spinner } from '../components/ui';

const bucketTone: Record<string, string> = {
  overdue: 'border-[#a13d2d] text-[#a13d2d]',
  lt24h: 'border-[#a13d2d] text-[#a13d2d]',
  lt48h: 'border-m-tasks text-m-tasks',
};

export default function FortnightPage() {
  const { user } = useAuth();
  const [start, setStart] = useState<string | null>(null); // null = this fortnight
  const [data, setData] = useState<FortnightPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<FortnightDay | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = start ? `?start=${start}` : '';
      setData(await api.get<FortnightPayload>(`/api/fortnight${qs}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [start]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <EmptyState icon="▦" title="Fortnight failed to load" hint={error} />;
  if (!data) return <Spinner label="Laying out the fortnight…" />;

  const today = DateTime.now().setZone(user!.tz).toISODate()!;
  const first = DateTime.fromISO(data.start);
  const last = DateTime.fromISO(data.days[data.days.length - 1]!.date);
  const isCurrent = data.start === mondayOf(today);

  const dayTitle = (d: string) => DateTime.fromISO(d).toFormat('ccc d LLL');

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="h-display text-3xl">
            <span className="mr-1 text-gold">✦</span>Fortnight
          </h1>
          <div className="tnum text-sm text-muted">
            {first.toFormat('d LLL')} – {last.toFormat('d LLL yyyy')}
            {isCurrent ? '' : ' · '}
            {!isCurrent && (
              <button className="underline" onClick={() => setStart(null)}>
                back to now
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="btn-ghost !py-1"
            aria-label="Previous fortnight"
            onClick={() => setStart(addDaysStr(data.start, -14))}
          >
            ‹
          </button>
          <button className="btn-ghost !py-1 text-xs" onClick={() => setStart(null)}>
            this fortnight
          </button>
          <button
            className="btn-ghost !py-1"
            aria-label="Next fortnight"
            onClick={() => setStart(addDaysStr(data.start, 14))}
          >
            ›
          </button>
        </div>
      </div>

      {/* desktop: two stacked weeks */}
      <div className="card hidden overflow-hidden md:block">
        <div className="grid grid-cols-7 border-b-2 border-edge text-center text-[11px] font-semibold uppercase tracking-wider text-muted">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {data.days.map((day) => (
            <DayCell key={day.date} day={day} today={today} onOpen={() => setOpenDay(day)} />
          ))}
        </div>
      </div>

      {/* mobile: 14-day agenda */}
      <div className="space-y-2 md:hidden">
        {data.days.map((day) => (
          <button
            key={day.date}
            className={`card-flat block w-full p-3 text-left ${day.date < today ? 'opacity-60' : ''} ${
              day.date === today ? 'ring-2 ring-gold' : ''
            }`}
            onClick={() => setOpenDay(day)}
          >
            <div className="mb-1 flex items-baseline justify-between">
              <span className="font-semibold">{dayTitle(day.date)}</span>
              {day.date === today && <span className="chip border-gold text-gold">today</span>}
            </div>
            <DayContents day={day} compact={false} />
            {day.classes.length === 0 && day.due_tasks.length === 0 && day.events.length === 0 && (
              <span className="text-xs text-muted">—</span>
            )}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted">
        Classes come from your <Link className="underline" to="/study">Study</Link> schedule; due
        dates from <Link className="underline" to="/tasks">Tasks</Link>. The full planner (events,
        availability, find-a-date) lives in <Link className="underline" to="/calendar">Calendar</Link>.
      </p>

      {openDay && (
        <DayPanel
          day={openDay}
          today={today}
          onClose={() => setOpenDay(null)}
          onChanged={() => {
            setOpenDay(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DayCell({
  day,
  today,
  onOpen,
}: {
  day: FortnightDay;
  today: string;
  onOpen: () => void;
}) {
  const dt = DateTime.fromISO(day.date);
  const isToday = day.date === today;
  const past = day.date < today;
  const weekend = dt.weekday >= 6;

  return (
    <button
      className={`min-h-[118px] border-b border-r border-line p-1.5 text-left align-top transition-colors hover:bg-paper ${
        past ? 'opacity-55' : ''
      } ${weekend ? 'bg-[color:color-mix(in_srgb,var(--ink)_4%,transparent)]' : ''} ${
        isToday ? 'bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)]' : ''
      }`}
      onClick={onOpen}
    >
      <div className={`tnum mb-1 text-xs ${isToday ? 'font-bold text-gold' : 'text-muted'}`}>
        {dt.day}
        {isToday && ' · today'}
      </div>
      <DayContents day={day} compact />
    </button>
  );
}

/** The shared class/task/event rows — compact for cells, roomier for agenda. */
function DayContents({ day, compact }: { day: FortnightDay; compact: boolean }) {
  const size = compact ? 'text-[10px]' : 'text-xs';
  return (
    <div className={`space-y-0.5 ${size}`}>
      {day.classes.map((c, i) => (
        <div key={`c${i}`} className="flex items-center gap-1 truncate" title={`${c.start}–${c.end} ${c.course_name}`}>
          <span
            className="inline-block h-2 w-2 flex-none rounded-full border border-edge"
            style={{ background: c.color ?? 'var(--m-study, #6b5ba5)' }}
          />
          <span className="tnum text-muted">{c.start}</span>
          <span className="truncate font-semibold">{c.course_name}</span>
        </div>
      ))}
      {day.due_tasks.map((t) => (
        <div
          key={t.id}
          className={`truncate rounded-sm border px-1 font-semibold ${
            t.is_completed
              ? 'border-line text-muted line-through'
              : (bucketTone[t.deadline_bucket] ?? 'border-edge')
          }`}
          title={t.title}
        >
          ◈ {t.title}
        </div>
      ))}
      {day.events.map((e) => (
        <div
          key={e.id}
          className={`truncate ${e.is_exam ? 'font-bold text-[#a13d2d]' : 'text-muted'}`}
          title={e.title}
        >
          {e.is_exam ? '▲ ' : ''}
          {e.icon ? `${e.icon} ` : ''}
          {e.title}
        </div>
      ))}
    </div>
  );
}

function DayPanel({
  day,
  today,
  onClose,
  onChanged,
}: {
  day: FortnightDay;
  today: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newTask, setNewTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTaskDue = async () => {
    if (!newTask.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // due end-of-day local (CONTRACT §4.11 buckets by local date)
      const due = DateTime.fromISO(`${day.date}T23:59`, { zone: user!.tz }).toUTC().toISO();
      await api.post('/api/tasks', { title: newTask.trim(), due_at: due });
      setNewTask('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const toggleTask = async (id: string) => {
    await api.post(`/api/tasks/${id}/toggle`);
    onChanged();
  };

  return (
    <Modal title={DateTime.fromISO(day.date).toFormat('cccc, d LLLL')} onClose={onClose}>
      <ErrorNote error={error} />

      {day.classes.length > 0 && (
        <>
          <div className="label">Classes</div>
          <ul className="mb-3 space-y-1 text-sm">
            {day.classes.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="tnum w-24 text-muted">
                  {c.start}–{c.end}
                </span>
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full border border-edge"
                  style={{ background: c.color ?? '#6b5ba5' }}
                />
                <span className="font-semibold">{c.course_name}</span>
                {c.location && <span className="text-xs text-muted">{c.location}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="label">Due this day</div>
      {day.due_tasks.length === 0 ? (
        <p className="mb-2 text-sm text-muted">Nothing due.</p>
      ) : (
        <ul className="mb-2 space-y-1 text-sm">
          {day.due_tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <button
                className={`h-4 w-4 flex-none border-2 border-edge ${t.is_completed ? 'bg-gold' : 'hover:bg-gold'}`}
                title={t.is_completed ? 'Reopen' : 'Done'}
                onClick={() => void toggleTask(t.id)}
              />
              <span className={t.is_completed ? 'text-muted line-through' : 'font-semibold'}>
                {t.title}
              </span>
              {!t.is_completed && t.deadline_bucket !== 'none' && (
                <span className={`chip ${bucketTone[t.deadline_bucket] ?? ''}`}>
                  {t.deadline_bucket === 'overdue' ? 'overdue' : t.deadline_bucket.replace('lt', '<')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mb-3 flex gap-2">
        <input
          className="input"
          placeholder={`New task due ${DateTime.fromISO(day.date).toFormat('d LLL')}…`}
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addTaskDue();
          }}
        />
        <button className="btn-primary" onClick={() => void addTaskDue()} disabled={busy || !newTask.trim()}>
          Add
        </button>
      </div>

      {day.events.length > 0 && (
        <>
          <div className="label">Events</div>
          <ul className="mb-3 space-y-1 text-sm">
            {day.events.map((e) => (
              <li key={e.id} className={e.is_exam ? 'font-bold text-[#a13d2d]' : ''}>
                {e.is_exam ? '▲ ' : ''}
                {e.icon ? `${e.icon} ` : ''}
                {e.title}
                <span className="ml-2 text-xs font-normal text-muted">
                  {e.all_day
                    ? 'all day'
                    : DateTime.fromISO(e.start_utc!).setZone(user!.tz).toFormat('HH:mm')}
                  {e.owner_name ? ` · ${e.owner_name}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <button className="btn-ghost text-xs" onClick={() => navigate('/study')}>
          △ Log a study session
        </button>
        <button className="btn-ghost text-xs" onClick={() => navigate('/focus')}>
          ◐ Start a focus session
        </button>
        {day.date === today && (
          <button className="btn-ghost text-xs" onClick={() => navigate('/overview')}>
            ◎ Open today's overview
          </button>
        )}
      </div>
    </Modal>
  );
}
