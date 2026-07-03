// Settings — profile, briefing hour, ntfy, groups & invite codes, habits
// management, the iCal feed, sign out.

import { useCallback, useEffect, useState } from 'react';
import type { Group, Habit } from '@lodestar/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorNote } from '../components/ui';

export default function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [color, setColor] = useState(user?.color ?? '#b7791f');
  const [tz, setTz] = useState(user?.tz ?? 'Europe/Zurich');
  const [briefingHour, setBriefingHour] = useState(user?.settings.briefing_hour ?? 7);
  const [ntfyTopic, setNtfyTopic] = useState(user?.settings.ntfy_topic ?? '');

  const [groups, setGroups] = useState<Group[]>([]);
  const [newGroup, setNewGroup] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const [habits, setHabits] = useState<Habit[]>([]);
  const [newHabit, setNewHabit] = useState({ name: '', emoji: '💧', target: 8 });

  const [icalPath, setIcalPath] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, h] = await Promise.all([
        api.get<{ groups: Group[] }>('/api/groups'),
        api.get<{ habits: Habit[] }>('/api/habits/today'),
      ]);
      setGroups(g.groups);
      setHabits(h.habits);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = async () => {
    setError(null);
    setSaved(false);
    try {
      await api.patch('/api/auth/me', {
        display_name: displayName,
        color,
        tz,
        settings: { briefing_hour: briefingHour, ntfy_topic: ntfyTopic || null },
      });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const createGroup = async () => {
    if (!newGroup.trim()) return;
    await api.post('/api/groups', { name: newGroup.trim() });
    setNewGroup('');
    await load();
  };

  const joinGroup = async () => {
    if (!joinCode.trim()) return;
    try {
      await api.post('/api/groups/join', { invite_code: joinCode.trim() });
      setJoinCode('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addHabit = async () => {
    if (!newHabit.name.trim()) return;
    await api.post('/api/habits', {
      name: newHabit.name.trim(),
      emoji: newHabit.emoji || '✦',
      target_per_day: newHabit.target,
    });
    setNewHabit({ name: '', emoji: '✦', target: 1 });
    await load();
  };

  const fetchIcal = async () => {
    const d = await api.get<{ path: string }>('/api/calendar/ical-url');
    setIcalPath(d.path);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="h-display text-3xl">⚙ Settings</h1>
      <ErrorNote error={error} />

      {/* profile */}
      <section className="card p-4">
        <h2 className="h-display mb-3 text-lg">Profile & assistant</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Display name</span>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            <span className="label">Your colour (calendar, presence)</span>
            <input type="color" className="input h-9 !p-0.5" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label>
            <span className="label">Timezone (IANA)</span>
            <input className="input" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Europe/Zurich" />
          </label>
          <label>
            <span className="label">Morning telegram hour</span>
            <select className="input" value={briefingHour} onChange={(e) => setBriefingHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className="label">ntfy topic (push notifications to your phone)</span>
            <input
              className="input"
              value={ntfyTopic ?? ''}
              onChange={(e) => setNtfyTopic(e.target.value)}
              placeholder="e.g. tim-lodestar-x7k2 — subscribe in the ntfy app"
            />
          </label>
        </div>
        <button className="btn-primary mt-3" onClick={() => void saveProfile()}>
          {saved ? 'Saved ✦' : 'Save'}
        </button>
      </section>

      {/* habits */}
      <section className="card p-4">
        <h2 className="h-display mb-1 text-lg">Habits</h2>
        <p className="mb-3 text-xs text-muted">
          Daily counters with streaks — water (水), gym, reading. Tap them on Today.
        </p>
        <ul className="mb-3 space-y-1.5">
          {habits.map((h) => (
            <li key={h.id} className="card-flat flex items-center gap-2 px-3 py-1.5 text-sm">
              <span>{h.emoji}</span>
              <span className="font-semibold">{h.name}</span>
              <span className="text-xs text-muted">target {h.target_per_day}/day</span>
              <button
                className="btn-ghost ml-auto !px-2 !py-0.5 text-xs"
                onClick={() => void api.patch(`/api/habits/${h.id}`, { archived: true }).then(load)}
              >
                archive
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            className="input !w-16 text-center"
            value={newHabit.emoji}
            onChange={(e) => setNewHabit({ ...newHabit, emoji: e.target.value })}
          />
          <input
            className="input min-w-32 flex-1"
            placeholder="Drink water"
            value={newHabit.name}
            onChange={(e) => setNewHabit({ ...newHabit, name: e.target.value })}
          />
          <input
            type="number"
            min={1}
            className="input !w-20"
            title="target per day"
            value={newHabit.target}
            onChange={(e) => setNewHabit({ ...newHabit, target: Number(e.target.value) })}
          />
          <button className="btn-primary" onClick={() => void addHabit()}>
            Add
          </button>
        </div>
      </section>

      {/* groups */}
      <section className="card p-4">
        <h2 className="h-display mb-1 text-lg">Groups</h2>
        <p className="mb-3 text-xs text-muted">
          Groups share calendars, availability and note tabs. Hand the invite code to friends —
          they register with it.
        </p>
        <ul className="mb-3 space-y-1.5">
          {groups.map((g) => (
            <li key={g.id} className="card-flat px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{g.name}</span>
                <code
                  className="cursor-pointer rounded-sm border border-line bg-paper px-1.5 py-0.5 text-xs"
                  title="Click to copy"
                  onClick={() => void navigator.clipboard.writeText(g.invite_code)}
                >
                  {g.invite_code} ⧉
                </code>
                <span className="ml-auto flex -space-x-1">
                  {g.members.map((m) => (
                    <span
                      key={m.id}
                      title={m.display_name}
                      className="inline-block h-4 w-4 rounded-full border border-ink"
                      style={{ background: m.color }}
                    />
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            className="input min-w-32 flex-1"
            placeholder="New group name"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
          />
          <button className="btn-ghost" onClick={() => void createGroup()}>
            Create
          </button>
          <input
            className="input min-w-32 flex-1"
            placeholder="Invite code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          <button className="btn-ghost" onClick={() => void joinGroup()}>
            Join
          </button>
        </div>
      </section>

      {/* ical */}
      <section className="card p-4">
        <h2 className="h-display mb-1 text-lg">Calendar feed (iCal)</h2>
        <p className="mb-3 text-xs text-muted">
          Subscribe from Google/Apple Calendar — a private tokened URL of everything you can see.
        </p>
        {icalPath ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm border border-line bg-paper px-2 py-1 text-xs">
              {location.origin}
              {icalPath}
            </code>
            <button
              className="btn-ghost !py-1 text-xs"
              onClick={() => void navigator.clipboard.writeText(`${location.origin}${icalPath}`)}
            >
              copy
            </button>
            <button
              className="btn-ghost !py-1 text-xs"
              onClick={() =>
                void api.post<{ path: string }>('/api/calendar/ical-rotate').then((d) => setIcalPath(d.path))
              }
            >
              rotate token
            </button>
          </div>
        ) : (
          <button className="btn-ghost" onClick={() => void fetchIcal()}>
            Reveal my feed URL
          </button>
        )}
      </section>

      <button className="btn-danger" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}
