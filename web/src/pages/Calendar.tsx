// Calendar — the Whenabouts port: month grid of shared events, availability
// & term tracking, and the find-a-date overlap finder.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type {
  AvailabilityEntry,
  CalendarEvent,
  FindDateResult,
  Term,
} from '@lodestar/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Modal } from '../components/ui';

type Tab = 'month' | 'availability' | 'terms' | 'find';

export default function CalendarPage() {
  const [tab, setTab] = useState<Tab>('month');
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="h-display mb-1 text-3xl">
        <span className="mr-1 text-m-calendar">☾</span>Calendar
      </h1>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            ['month', 'Month'],
            ['availability', 'Availability'],
            ['terms', 'Terms & breaks'],
            ['find', 'Find a date'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            className={`chip cursor-pointer ${tab === key ? 'bg-m-calendar text-white' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'month' && <MonthView />}
      {tab === 'availability' && <AvailabilityView />}
      {tab === 'terms' && <TermsView />}
      {tab === 'find' && <FindView />}
    </div>
  );
}

// ── month grid ───────────────────────────────────────────────────────────────

function MonthView() {
  const { user } = useAuth();
  const [cursor, setCursor] = useState(() => DateTime.now().startOf('month'));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [availability, setAvailability] = useState<AvailabilityEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gridStart = cursor.startOf('week'); // luxon weeks start Monday
  const gridEnd = cursor.endOf('month').endOf('week');

  const load = useCallback(async () => {
    try {
      const from = gridStart.toISODate()!;
      const to = gridEnd.toISODate()!;
      const [ev, av] = await Promise.all([
        api.get<{ events: CalendarEvent[] }>(`/api/calendar/events?from=${from}&to=${to}`),
        api.get<{ availability: AvailabilityEntry[] }>('/api/calendar/availability'),
      ]);
      setEvents(ev.events);
      setAvailability(av.availability);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [gridStart.toISODate(), gridEnd.toISODate()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => {
    const out: DateTime[] = [];
    let d = gridStart;
    while (d <= gridEnd) {
      out.push(d);
      d = d.plus({ days: 1 });
    }
    return out;
  }, [gridStart.toISODate(), gridEnd.toISODate()]); // eslint-disable-line react-hooks/exhaustive-deps

  const eventsOn = (date: string) =>
    events.filter((e) =>
      e.all_day
        ? e.start_date! <= date && e.end_date! >= date
        : DateTime.fromISO(e.start_utc!).setZone(user!.tz).toISODate() === date,
    );

  const awayOn = (date: string) =>
    availability.filter((a) => a.status !== 'free' && a.start_date <= date && a.end_date >= date);

  const today = DateTime.now().setZone(user!.tz).toISODate();

  return (
    <div>
      <ErrorNote error={error} />
      <div className="mb-2 flex items-center justify-between">
        <button className="btn-ghost !py-0.5" onClick={() => setCursor(cursor.minus({ months: 1 }))}>
          ←
        </button>
        <div className="h-display text-xl">{cursor.toFormat('LLLL yyyy')}</div>
        <div className="flex gap-1.5">
          <button className="btn-ghost !py-0.5 text-xs" onClick={() => setCursor(DateTime.now().startOf('month'))}>
            today
          </button>
          <button className="btn-ghost !py-0.5" onClick={() => setCursor(cursor.plus({ months: 1 }))}>
            →
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b-2 border-ink text-center text-[11px] font-semibold uppercase tracking-wider text-muted">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const date = d.toISODate()!;
            const inMonth = d.month === cursor.month;
            const dayEvents = eventsOn(date);
            const away = awayOn(date);
            return (
              <button
                key={date}
                className={`min-h-[72px] border-b border-r border-line p-1 text-left align-top hover:bg-paper ${
                  inMonth ? '' : 'opacity-40'
                } ${date === today ? 'bg-gold/10' : ''}`}
                onClick={() => setSelected(date)}
              >
                <div className="flex items-center justify-between">
                  <span className={`tnum text-xs ${date === today ? 'font-bold text-gold' : 'text-muted'}`}>
                    {d.day}
                  </span>
                  <span className="flex gap-0.5">
                    {away.slice(0, 3).map((a) => (
                      <span
                        key={a.id}
                        title={`${a.user_name}: ${a.status}${a.note ? ` — ${a.note}` : ''}`}
                        className="inline-block h-1.5 w-1.5 rounded-full border border-ink"
                        style={{ background: a.user_color, opacity: a.status === 'maybe' ? 0.5 : 1 }}
                      />
                    ))}
                  </span>
                </div>
                {dayEvents.slice(0, 3).map((e) => (
                  <div
                    key={e.id}
                    className="mt-0.5 truncate rounded-sm border border-ink px-1 text-[10px] font-semibold"
                    style={{ background: `${e.color ?? e.owner_color ?? 'var(--gold)'}33` }}
                    title={`${e.title} (${e.owner_name})`}
                  >
                    {e.icon ? `${e.icon} ` : ''}
                    {e.title}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-muted">+{dayEvents.length - 3} more</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <DayModal
          date={selected}
          events={eventsOn(selected)}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
          onCreate={() => setCreating(true)}
        />
      )}
      {creating && selected && (
        <EventModal
          date={selected}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DayModal({
  date,
  events,
  onClose,
  onChanged,
  onCreate,
}: {
  date: string;
  events: CalendarEvent[];
  onClose: () => void;
  onChanged: () => void;
  onCreate: () => void;
}) {
  const { user } = useAuth();
  return (
    <Modal title={DateTime.fromISO(date).toFormat('cccc, d LLLL')} onClose={onClose}>
      {events.length === 0 ? (
        <p className="mb-3 text-sm text-muted">Nothing on this day.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {events.map((e) => (
            <li key={e.id} className="card-flat flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">
                  {e.icon ? `${e.icon} ` : ''}
                  {e.title}
                </span>
                <span className="ml-2 text-xs text-muted">
                  {e.all_day
                    ? `all day${e.start_date !== e.end_date ? ` (${e.start_date} → ${e.end_date})` : ''}`
                    : `${DateTime.fromISO(e.start_utc!).setZone(user!.tz).toFormat('HH:mm')}–${DateTime.fromISO(e.end_utc!).setZone(user!.tz).toFormat('HH:mm')}`}
                  {' · '}
                  {e.owner_name}
                  {e.group_id ? ' · shared' : ''}
                </span>
              </span>
              {e.owner_id === user?.id && (
                <button
                  className="btn-danger !px-2 !py-0.5 text-xs"
                  onClick={() => {
                    void api.del(`/api/calendar/events/${e.id}`).then(onChanged);
                  }}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button className="btn-primary" onClick={onCreate}>
        + Add event on {DateTime.fromISO(date).toFormat('d LLL')}
      </button>
    </Modal>
  );
}

function EventModal({
  date,
  onClose,
  onSaved,
}: {
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [endDate, setEndDate] = useState(date);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:00');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ groups: Array<{ id: string; name: string }> }>('/api/groups')
      .then((d) => setGroups(d.groups))
      .catch(() => {});
  }, []);

  const save = async () => {
    setError(null);
    try {
      const base = { title, icon: icon || null, group_id: groupId || null };
      if (allDay) {
        await api.post('/api/calendar/events', {
          ...base,
          all_day: true,
          start_date: date,
          end_date: endDate < date ? date : endDate,
        });
      } else {
        const s = DateTime.fromISO(`${date}T${startTime}`, { zone: user!.tz });
        let e = DateTime.fromISO(`${date}T${endTime}`, { zone: user!.tz });
        if (e <= s) e = s.plus({ hours: 1 });
        await api.post('/api/calendar/events', {
          ...base,
          all_day: false,
          start_utc: s.toUTC().toISO(),
          end_utc: e.toUTC().toISO(),
        });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title="New event" onClose={onClose}>
      <ErrorNote error={error} />
      <label className="label">Title</label>
      <input className="input mb-3" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <div className="mb-3 flex gap-3">
        <label className="flex-1">
          <span className="label">Icon (emoji)</span>
          <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🎉" />
        </label>
        <label className="flex-1">
          <span className="label">Share with</span>
          <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">just me</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        All-day
      </label>
      {allDay ? (
        <label className="mb-3 block">
          <span className="label">Until (inclusive)</span>
          <input type="date" className="input" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      ) : (
        <div className="mb-3 flex gap-3">
          <label className="flex-1">
            <span className="label">From</span>
            <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="flex-1">
            <span className="label">To</span>
            <input type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
      )}
      <button className="btn-primary" onClick={() => void save()} disabled={!title.trim()}>
        Save event
      </button>
    </Modal>
  );
}

// ── availability ─────────────────────────────────────────────────────────────

function AvailabilityView() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<AvailabilityEntry[]>([]);
  const [status, setStatus] = useState<'free' | 'busy' | 'maybe'>('busy');
  const [start, setStart] = useState(DateTime.now().toISODate()!);
  const [end, setEnd] = useState(DateTime.now().toISODate()!);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api.get<{ availability: AvailabilityEntry[] }>('/api/calendar/availability');
    setEntries(d.availability);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, [load]);

  const add = async () => {
    setError(null);
    try {
      await api.post('/api/calendar/availability', {
        status,
        start_date: start,
        end_date: end < start ? start : end,
        note: note || null,
      });
      setNote('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const statusLabel = { free: 'Free', busy: 'Away/Busy', maybe: 'Maybe' };

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Mark yourself free, away or maybe over date ranges — this drives the calendar's away markers
        and the date finder. Explicit entries always beat term/break inference.
      </p>
      <ErrorNote error={error} />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label>
          <span className="label">Status</span>
          <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="busy">Away / busy</option>
            <option value="free">Free</option>
            <option value="maybe">Maybe</option>
          </select>
        </label>
        <label>
          <span className="label">From</span>
          <input type="date" className="input !w-auto" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span className="label">To</span>
          <input type="date" className="input !w-auto" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="min-w-32 flex-1">
          <span className="label">Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="visiting home…" />
        </label>
        <button className="btn-primary" onClick={() => void add()}>Add</button>
      </div>
      <ul className="space-y-1.5">
        {entries.map((a) => (
          <li key={a.id} className="card-flat flex items-center gap-2 px-3 py-2 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-ink" style={{ background: a.user_color }} />
            <span className="font-semibold">{a.user_name}</span>
            <span className="chip">{statusLabel[a.status]}</span>
            <span className="tnum text-muted">
              {a.start_date} → {a.end_date}
            </span>
            {a.note && <span className="truncate text-xs text-muted">{a.note}</span>}
            {a.user_id === user?.id && (
              <button
                className="btn-ghost ml-auto !px-2 !py-0.5 text-xs"
                onClick={() => void api.del(`/api/calendar/availability/${a.id}`).then(load)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── terms & breaks ───────────────────────────────────────────────────────────

function TermsView() {
  const { user } = useAuth();
  const [terms, setTerms] = useState<Term[]>([]);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'term' | 'break'>('term');
  const [start, setStart] = useState(DateTime.now().toISODate()!);
  const [end, setEnd] = useState(DateTime.now().plus({ months: 3 }).toISODate()!);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api.get<{ terms: Term[] }>('/api/calendar/terms');
    setTerms(d.terms);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, [load]);

  const add = async () => {
    setError(null);
    try {
      await api.post('/api/calendar/terms', {
        label,
        kind,
        start_date: start,
        end_date: end < start ? start : end,
      });
      setLabel('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Record busy school/work periods (<b>terms</b>) and holidays (<b>breaks</b>). The date finder
        can treat "on a break" as "free". Breaks also unlock backlog suggestions on Today.
      </p>
      <ErrorNote error={error} />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-32 flex-1">
          <span className="label">Label</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="HS26 · summer break…" />
        </label>
        <label>
          <span className="label">Kind</span>
          <select className="input !w-auto" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="term">Term (busy)</option>
            <option value="break">Break (free)</option>
          </select>
        </label>
        <label>
          <span className="label">From</span>
          <input type="date" className="input !w-auto" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span className="label">To</span>
          <input type="date" className="input !w-auto" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <button className="btn-primary" onClick={() => void add()} disabled={!label.trim()}>
          Add
        </button>
      </div>
      <ul className="space-y-1.5">
        {terms.map((t) => (
          <li key={t.id} className="card-flat flex items-center gap-2 px-3 py-2 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-ink" style={{ background: t.user_color }} />
            <span className="font-semibold">{t.user_name}</span>
            <span className={`chip ${t.kind === 'break' ? 'border-m-habits text-m-habits' : ''}`}>{t.kind}</span>
            <span>{t.label}</span>
            <span className="tnum text-muted">
              {t.start_date} → {t.end_date}
            </span>
            {t.user_id === user?.id && (
              <button
                className="btn-ghost ml-auto !px-2 !py-0.5 text-xs"
                onClick={() => void api.del(`/api/calendar/terms/${t.id}`).then(load)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── find a date ──────────────────────────────────────────────────────────────

function FindView() {
  const [start, setStart] = useState(DateTime.now().toISODate()!);
  const [end, setEnd] = useState(DateTime.now().plus({ months: 1 }).toISODate()!);
  const [minPeople, setMinPeople] = useState(2);
  const [onlyOnBreak, setOnlyOnBreak] = useState(false);
  const [result, setResult] = useState<FindDateResult | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; display_name: string; color: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        start_date: start,
        end_date: end,
        min_people: String(minPeople),
        only_on_break: String(onlyOnBreak),
      });
      const d = await api.get<{ result: FindDateResult; users: typeof users }>(
        `/api/calendar/find?${params}`,
      );
      setResult(d.result);
      setUsers(d.users);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: string) => users.find((u) => u.id === id)?.display_name ?? '?';

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Finds the longest stretches where the <i>same</i> set of at least N people are all free —
        ranked best-first. Only explicit "free" counts, unless you let breaks imply free.
      </p>
      <ErrorNote error={error} />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label>
          <span className="label">From</span>
          <input type="date" className="input !w-auto" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span className="label">To</span>
          <input type="date" className="input !w-auto" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label>
          <span className="label">Min people</span>
          <input
            type="number"
            min={1}
            max={50}
            className="input !w-20"
            value={minPeople}
            onChange={(e) => setMinPeople(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input type="checkbox" checked={onlyOnBreak} onChange={(e) => setOnlyOnBreak(e.target.checked)} />
          break ⇒ free
        </label>
        <button className="btn-primary" onClick={() => void run()} disabled={busy}>
          {busy ? 'Searching…' : 'Find dates'}
        </button>
      </div>

      {result &&
        (result.windows.length === 0 ? (
          <p className="text-sm text-muted">
            No window found where {result.min_people}+ of you are free. Widen the range, or get
            people to fill in availability.
          </p>
        ) : (
          <ol className="space-y-2">
            {result.windows.map((w, i) => (
              <li key={i} className="card-flat px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="h-display">
                    {DateTime.fromISO(w.start_date).toFormat('d LLL')}
                    {w.end_date !== w.start_date && ` → ${DateTime.fromISO(w.end_date).toFormat('d LLL')}`}
                  </span>
                  <span className="chip border-m-calendar text-m-calendar">
                    {w.length} day{w.length > 1 ? 's' : ''}
                  </span>
                  <span className="chip">{w.free_count} free</span>
                  <span className="text-xs text-muted">{w.free_user_ids.map(nameOf).join(', ')}</span>
                </div>
              </li>
            ))}
          </ol>
        ))}
    </div>
  );
}
