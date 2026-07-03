// Today — where the six modules meet: the telegram, the schedule with its
// gaps, the order of execution (gap-fit chips), pace warnings, habit taps,
// and the backlog-as-reward.

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { Link } from 'react-router-dom';
import type { AssistantDoc, TodayPayload } from '@lodestar/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Spinner, Telegram, loadDots } from '../components/ui';

export default function TodayPage() {
  const { user } = useAuth();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefingBusy, setBriefingBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<TodayPayload>('/api/today'));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchBriefing = async (regenerate: boolean) => {
    setBriefingBusy(true);
    try {
      const { briefing } = regenerate
        ? await api.post<{ briefing: AssistantDoc }>('/api/assistant/briefing/regenerate')
        : await api.get<{ briefing: AssistantDoc }>('/api/assistant/briefing');
      setData((d) => (d ? { ...d, briefing } : d));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBriefingBusy(false);
    }
  };

  const tapHabit = async (id: string, delta: number) => {
    await api.post(`/api/habits/${id}/log`, { delta });
    void load();
  };

  const toggleTask = async (id: string) => {
    await api.post(`/api/tasks/${id}/toggle`);
    void load();
  };

  if (error) return <EmptyState icon="⚠" title="Today failed to load" hint={error} />;
  if (!data) return <Spinner label="Charting the day…" />;

  const dt = DateTime.fromISO(data.date);
  const fmtEvent = (e: TodayPayload['events'][number]) =>
    e.all_day
      ? 'all day'
      : `${DateTime.fromISO(e.start_utc!).setZone(user!.tz).toFormat('HH:mm')}–${DateTime.fromISO(e.end_utc!).setZone(user!.tz).toFormat('HH:mm')}`;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="h-display text-3xl">{dt.toFormat('cccc')}</h1>
          <div className="text-sm text-muted">
            {dt.toFormat('d LLLL yyyy')}
            {data.on_break && <span className="chip ml-2 border-m-habits text-m-habits">on break</span>}
          </div>
        </div>
        <span className="text-3xl text-gold">✦</span>
      </div>

      {/* telegram */}
      <div className="card mb-4 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="h-display text-lg">Morning telegram</h2>
          <button
            className="btn-ghost !py-0.5 text-xs"
            disabled={briefingBusy}
            onClick={() => void fetchBriefing(Boolean(data.briefing))}
          >
            {briefingBusy ? '…' : data.briefing ? 'Re-file ↻' : 'File it now'}
          </button>
        </div>
        {data.briefing ? (
          <Telegram md={data.briefing.content} />
        ) : (
          <p className="text-sm text-muted">
            No telegram yet today — it files itself at {user?.settings.briefing_hour}:00, or press the button.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* schedule */}
        <div className="card p-4">
          <h2 className="h-display mb-2 text-lg">
            <span className="mr-1 text-m-calendar">☾</span> Schedule
          </h2>
          {data.lecture_blocks.length === 0 && data.events.length === 0 ? (
            <p className="text-sm text-muted">A blank page of a day. Fill it deliberately.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.lecture_blocks.map((b, i) => (
                <li key={`b${i}`} className="flex items-center gap-2">
                  <span className="tnum w-24 shrink-0 text-muted">{b.start}–{b.end}</span>
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-ink"
                    style={{ background: b.color ?? 'var(--gold)' }}
                  />
                  <span className="font-semibold">{b.course_name}</span>
                  {b.location && <span className="text-xs text-muted">{b.location}</span>}
                </li>
              ))}
              {data.gaps.map((g, i) => (
                <li key={`g${i}`} className="flex items-center gap-2 text-xs text-muted">
                  <span className="tnum w-24 shrink-0">{g.start}–{g.end}</span>
                  <span className="chip border-m-tasks text-m-tasks">{g.minutes} min gap — quick-win window</span>
                </li>
              ))}
              {data.events.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <span className="tnum w-24 shrink-0 text-muted">{fmtEvent(e)}</span>
                  <span>{e.icon ? `${e.icon} ` : ''}{e.title}</span>
                  {e.owner_id !== user?.id && (
                    <span
                      className="inline-block h-2 w-2 rounded-full border border-ink"
                      style={{ background: e.owner_color }}
                      title={e.owner_name}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link to="/calendar" className="mt-2 inline-block text-xs text-muted underline">
            open calendar →
          </Link>
        </div>

        {/* order of execution */}
        <div className="card p-4">
          <h2 className="h-display mb-2 text-lg">
            <span className="mr-1 text-m-tasks">◈</span> Order of execution
          </h2>
          {data.top_tasks.length === 0 ? (
            <p className="text-sm text-muted">Nothing open. Either bliss or denial.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {data.top_tasks.map((t, i) => (
                <li key={t.id} className="flex items-start gap-2">
                  <button
                    className="mt-0.5 h-4 w-4 shrink-0 border-2 border-ink hover:bg-gold"
                    title="Done"
                    onClick={() => void toggleTask(t.id)}
                  />
                  <span className="tnum w-4 shrink-0 text-muted">{i + 1}.</span>
                  <span className="min-w-0">
                    <span className="font-semibold">{t.title}</span>
                    <span className="ml-1.5 whitespace-nowrap text-xs text-muted">
                      {loadDots(t.cognitive_load)} ~{t.duration_min}m
                    </span>
                    {t.deadline_bucket !== 'none' && (
                      <span className="chip ml-1.5 border-[#a13d2d] text-[#a13d2d]">
                        {t.deadline_bucket === 'overdue' ? 'overdue' : `due ${t.deadline_bucket.replace('lt', '<')}`}
                      </span>
                    )}
                    {t.fits_gap && (
                      <span className="chip ml-1.5 border-m-tasks text-m-tasks">
                        fits {t.fits_gap.start} gap
                      </span>
                    )}
                    {t.is_starving && <span className="chip ml-1.5">starving</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Link to="/tasks" className="mt-2 inline-block text-xs text-muted underline">
            all tasks →
          </Link>
        </div>

        {/* pace warnings */}
        {data.pace_warnings.length > 0 && (
          <div className="card border-[#a13d2d] p-4">
            <h2 className="h-display mb-2 text-lg">
              <span className="mr-1 text-m-study">△</span> Behind pace
            </h2>
            <ul className="space-y-1.5 text-sm">
              {data.pace_warnings.map((w) => (
                <li key={w.course_id}>
                  <span className="font-semibold">{w.course_name}</span>{' '}
                  <span className="text-muted">
                    {w.deficit_hours}h behind · needs {w.required_velocity}h/day · trending{' '}
                    {w.predicted_grade.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
            <Link to="/study" className="mt-2 inline-block text-xs underline">
              book a study block →
            </Link>
          </div>
        )}

        {/* habits */}
        <div className="card p-4">
          <h2 className="h-display mb-2 text-lg">
            <span className="mr-1 text-m-habits">✚</span> Habits
          </h2>
          {data.habits.length === 0 ? (
            <p className="text-sm text-muted">
              No habits yet — add water, gym, reading in <Link className="underline" to="/settings">Settings</Link>.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.habits.map((h) => (
                <li key={h.id} className="flex items-center gap-2 text-sm">
                  <span className="w-6 text-center">{h.emoji}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{h.name}</span>
                  {h.streak > 1 && <span className="chip border-m-habits text-m-habits">🔥 {h.streak}</span>}
                  <span className="tnum text-muted">
                    {h.today_count}/{h.target_per_day}
                  </span>
                  <button
                    className="btn-ghost !px-2 !py-0"
                    onClick={() => void tapHabit(h.id, -1)}
                    disabled={h.today_count === 0}
                  >
                    −
                  </button>
                  <button
                    className={`${h.today_count >= h.target_per_day ? 'btn-ghost' : 'btn-primary'} !px-2 !py-0`}
                    onClick={() => void tapHabit(h.id, 1)}
                  >
                    +
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* backlog as reward */}
        {data.media_suggestions.length > 0 && (
          <div className="card p-4 md:col-span-2">
            <h2 className="h-display mb-1 text-lg">
              <span className="mr-1 text-m-backlog">☰</span> Off duty
            </h2>
            <p className="mb-2 text-xs text-muted">{data.media_reason}</p>
            <div className="flex flex-wrap gap-3">
              {data.media_suggestions.map((m) => (
                <Link key={m.id} to="/backlog" className="card-flat flex items-center gap-2 px-3 py-2 text-sm hover:shadow-almanac-sm">
                  {m.image_url && (
                    <img src={m.image_url} alt="" className="h-12 w-8 border border-ink object-cover" />
                  )}
                  <span>
                    <span className="font-semibold">{m.title}</span>
                    <span className="ml-1 text-xs text-muted">({m.domain})</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
