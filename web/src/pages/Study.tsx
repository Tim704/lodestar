// Study — the Study Velocity Tracker port: semesters, courses by ECTS,
// lecture slots, session logging (plus a pomodoro that logs itself),
// required velocity & predicted grades, and bookable study blocks.

import { useCallback, useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  calculatePredictedGrade,
  type Course,
  type CourseOverview,
  type Semester,
  type StudyBlockProposal,
} from '@lodestar/shared';
import { api } from '../api';
import { EmptyState, ErrorNote, Meter, Modal, Spinner, StatTile } from '../components/ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Overview {
  semester: Semester | null;
  courses: CourseOverview[];
}

export default function StudyPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [blocks, setBlocks] = useState<StudyBlockProposal[]>([]);
  const [semesterId, setSemesterId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [editSemesters, setEditSemesters] = useState(false);
  const [editCourse, setEditCourse] = useState<CourseOverview | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const [ov, sems, bl] = await Promise.all([
        api.get<Overview>(`/api/study/overview${semesterId ? `?semester_id=${semesterId}` : ''}`),
        api.get<{ semesters: Semester[] }>('/api/study/semesters'),
        api.get<{ blocks: StudyBlockProposal[] }>('/api/study/blocks'),
      ]);
      setOverview(ov);
      setSemesters(sems.semesters);
      setBlocks(bl.blocks);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [semesterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const bookBlock = async (b: StudyBlockProposal) => {
    await api.post('/api/study/blocks/book', {
      course_id: b.course_id,
      date: b.date,
      start: b.start,
      minutes: b.minutes,
    });
    setBlocks((prev) => prev.filter((x) => x !== b));
  };

  if (!overview) return <Spinner label="Computing velocity…" />;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="h-display text-3xl">
          <span className="mr-1 text-m-study">△</span>Study
        </h1>
        <div className="flex items-center gap-2">
          <select
            className="input !w-auto"
            value={semesterId || overview.semester?.id || ''}
            onChange={(e) => setSemesterId(e.target.value)}
          >
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_active ? ' ✦' : ''}
              </option>
            ))}
          </select>
          <button className="btn-ghost !py-1 text-xs" onClick={() => setEditSemesters(true)}>
            semesters…
          </button>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted">
        Hours vs ECTS targets. Required velocity is hours/day to finish on time; the grade is a
        projection, not a promise.
      </p>

      <ErrorNote error={error} />

      {overview.semester && <Pomodoro courses={overview.courses} onLogged={() => void load()} />}

      {blocks.length > 0 && (
        <div className="card mb-4 border-m-study p-3">
          <h2 className="h-display mb-1 text-lg">Proposed study blocks</h2>
          <p className="mb-2 text-xs text-muted">
            You're behind in {new Set(blocks.map((b) => b.course_id)).size} course(s) — book a slot
            and it lands on your calendar.
          </p>
          <div className="flex flex-wrap gap-2">
            {blocks.map((b, i) => (
              <div key={i} className="card-flat flex items-center gap-2 px-2.5 py-1.5 text-sm">
                <span className="font-semibold">{b.course_name}</span>
                <span className="tnum text-xs text-muted">
                  {DateTime.fromISO(b.date).toFormat('ccc d LLL')} {b.start}–{b.end}
                </span>
                <button className="btn-primary !px-2 !py-0.5 text-xs" onClick={() => void bookBlock(b)}>
                  Book
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!overview.semester ? (
        <EmptyState
          icon="△"
          title="No semester yet"
          hint='Create one via "semesters…" above — then add courses with their ECTS.'
        />
      ) : overview.courses.length === 0 ? (
        <EmptyState icon="△" title="No courses in this semester" hint="Add your first course below." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {overview.courses.map((c) => (
            <CourseCard key={c.id} course={c} onChanged={() => void load()} onEdit={() => setEditCourse(c)} />
          ))}
        </div>
      )}

      {overview.semester && (
        <button className="btn-ghost mt-4" onClick={() => setEditCourse('new')}>
          + Add course
        </button>
      )}

      {editSemesters && (
        <SemesterModal
          semesters={semesters}
          onClose={() => setEditSemesters(false)}
          onChanged={() => void load()}
        />
      )}
      {editCourse && overview.semester && (
        <CourseModal
          course={editCourse === 'new' ? null : editCourse}
          semesterId={overview.semester.id}
          onClose={() => setEditCourse(null)}
          onChanged={() => {
            setEditCourse(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── pomodoro that logs itself ────────────────────────────────────────────────

function Pomodoro({ courses, onLogged }: { courses: CourseOverview[]; onLogged: () => void }) {
  const [courseId, setCourseId] = useState('');
  const [minutes, setMinutes] = useState(25);
  const [left, setLeft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!courseId && courses.length) setCourseId(courses[0]!.id);
  }, [courses, courseId]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const start = () => {
    setLeft(minutes * 60);
    timer.current = setInterval(() => {
      setLeft((l) => {
        if (l === null) return null;
        if (l <= 1) {
          if (timer.current) clearInterval(timer.current);
          void api
            .post('/api/study/sessions', {
              course_id: courseId,
              date: DateTime.now().toISODate(),
              minutes,
              is_self_study: true,
              note: 'pomodoro',
            })
            .then(onLogged);
          try {
            new Notification('✦ Pomodoro done', { body: 'Session logged. Stretch.' });
          } catch {
            /* notifications not granted */
          }
          return null;
        }
        return l - 1;
      });
    }, 1000);
  };

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    setLeft(null);
  };

  if (!courses.length) return null;

  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
      <span className="h-display text-lg">⏳ Focus</span>
      <select className="input !w-auto" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={left !== null}>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {left === null ? (
        <>
          {[25, 50, 90].map((m) => (
            <button
              key={m}
              className={`chip cursor-pointer ${minutes === m ? 'bg-m-study text-white' : ''}`}
              onClick={() => setMinutes(m)}
            >
              {m}m
            </button>
          ))}
          <button
            className="btn-primary"
            onClick={() => {
              if ('Notification' in window && Notification.permission === 'default') {
                void Notification.requestPermission();
              }
              start();
            }}
          >
            Start
          </button>
          <span className="text-xs text-muted">finishes → auto-logs the session</span>
        </>
      ) : (
        <>
          <span className="h-display tnum text-2xl">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </span>
          <button className="btn-ghost" onClick={stop}>
            Abandon (no log)
          </button>
        </>
      )}
    </div>
  );
}

// ── course card ──────────────────────────────────────────────────────────────

function CourseCard({
  course: c,
  onChanged,
  onEdit,
}: {
  course: CourseOverview;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [logMinutes, setLogMinutes] = useState(60);
  const [selfStudy, setSelfStudy] = useState(true);
  const [whatIf, setWhatIf] = useState(c.pace.required_velocity || 1);

  const logSession = async () => {
    await api.post('/api/study/sessions', {
      course_id: c.id,
      date: DateTime.now().toISODate(),
      minutes: logMinutes,
      is_self_study: selfStudy,
    });
    onChanged();
  };

  const projected = calculatePredictedGrade(
    c.pace.logged_hours + whatIf * c.pace.days_remaining,
    c.pace.target_hours,
  );

  const behind = c.pace.status === 'behind';

  return (
    <div className={`card p-4 ${behind ? 'border-[#a13d2d]' : ''}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="h-display text-lg" style={{ color: c.color ?? undefined }}>
            {c.name}
          </h3>
          <div className="text-xs text-muted">
            {c.ects} ECTS · target {c.pace.target_hours}h
            {c.slots.length > 0 &&
              ` · ${c.slots.map((s) => `${WEEKDAYS[s.weekday]} ${s.start_time}`).join(', ')}`}
          </div>
        </div>
        <span className={`chip ${behind ? 'border-[#a13d2d] text-[#a13d2d]' : 'border-m-habits text-m-habits'}`}>
          {c.pace.status}
        </span>
      </div>

      <Meter pct={c.pace.roi} tone={behind ? 'warn' : 'ok'} />
      <div className="mt-1 text-xs text-muted">
        {c.pace.logged_hours}h logged ({c.pace.logged_self_hours} self + {c.pace.logged_lecture_hours} lecture)
        · {c.pace.roi}% of target
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatTile label="Needs" value={`${c.pace.required_velocity}`} sub="h/day" />
        <StatTile label="Days left" value={c.pace.days_remaining} />
        <StatTile label="Trending" value={c.pace.predicted_grade.toFixed(1)} sub="grade" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
        <span className="text-xs text-muted">Log:</span>
        {[30, 60, 90, 120].map((m) => (
          <button
            key={m}
            className={`chip cursor-pointer ${logMinutes === m ? 'bg-m-study text-white' : ''}`}
            onClick={() => setLogMinutes(m)}
          >
            {m}m
          </button>
        ))}
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={selfStudy} onChange={(e) => setSelfStudy(e.target.checked)} />
          self-study
        </label>
        <button className="btn-primary !py-0.5 text-xs" onClick={() => void logSession()}>
          Log today
        </button>
      </div>

      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none">what-if projector</summary>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={8}
            step={0.5}
            value={whatIf}
            onChange={(e) => setWhatIf(Number(e.target.value))}
            className="flex-1"
          />
          <span className="tnum whitespace-nowrap">
            {whatIf}h/day → grade <b className="text-ink">{projected.toFixed(1)}</b>
          </span>
        </div>
      </details>

      <button className="btn-ghost mt-2 !py-0.5 text-xs" onClick={onEdit}>
        edit course & lecture slots…
      </button>
    </div>
  );
}

// ── modals ───────────────────────────────────────────────────────────────────

function SemesterModal({
  semesters,
  onClose,
  onChanged,
}: {
  semesters: Semester[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [start, setStart] = useState(DateTime.now().toISODate()!);
  const [end, setEnd] = useState(DateTime.now().plus({ months: 4 }).toISODate()!);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    try {
      await api.post('/api/study/semesters', {
        name,
        start_date: start,
        end_date: end,
        is_active: true,
      });
      setName('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title="Semesters" onClose={onClose}>
      <ErrorNote error={error} />
      <ul className="mb-3 space-y-1.5">
        {semesters.map((s) => (
          <li key={s.id} className="card-flat flex items-center gap-2 px-3 py-2 text-sm">
            <span className="font-semibold">{s.name}</span>
            <span className="tnum text-xs text-muted">
              {s.start_date} → {s.end_date}
            </span>
            {s.is_active ? (
              <span className="chip ml-auto border-gold text-gold">active ✦</span>
            ) : (
              <button
                className="btn-ghost ml-auto !px-2 !py-0.5 text-xs"
                onClick={() => void api.patch(`/api/study/semesters/${s.id}`, { is_active: true }).then(onChanged)}
              >
                make active
              </button>
            )}
            <button
              className="btn-ghost !px-2 !py-0.5 text-xs"
              onClick={() => {
                if (confirm(`Delete "${s.name}" and all its courses/sessions?`)) {
                  void api.del(`/api/study/semesters/${s.id}`).then(onChanged);
                }
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-line pt-3">
        <label className="label">New semester</label>
        <input className="input mb-2" placeholder="HS26" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="mb-3 flex gap-2">
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => void add()} disabled={!name.trim()}>
          Create (and make active)
        </button>
      </div>
    </Modal>
  );
}

function CourseModal({
  course,
  semesterId,
  onClose,
  onChanged,
}: {
  course: CourseOverview | null;
  semesterId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(course?.name ?? '');
  const [ects, setEcts] = useState(course?.ects ?? 6);
  const [targetHours, setTargetHours] = useState<number>(course ? Number(course.target_hours) : 6 * 30);
  const [color, setColor] = useState(course?.color ?? '#6b5ba5');
  const [slots, setSlots] = useState<Array<{ weekday: number; start_time: string; end_time: string; location: string }>>(
    course?.slots.map((s) => ({
      weekday: s.weekday,
      start_time: s.start_time,
      end_time: s.end_time,
      location: s.location ?? '',
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      let id = course?.id;
      if (course) {
        await api.patch(`/api/study/courses/${course.id}`, { name, ects, target_hours: targetHours, color });
      } else {
        const created = await api.post<{ course: Course }>('/api/study/courses', {
          semester_id: semesterId,
          name,
          ects,
          target_hours: targetHours,
          color,
        });
        id = created.course.id;
      }
      await api.put(`/api/study/courses/${id}/slots`, {
        slots: slots
          .filter((s) => s.start_time && s.end_time && s.start_time < s.end_time)
          .map((s) => ({ ...s, location: s.location || null })),
      });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title={course ? `Edit ${course.name}` : 'New course'} onClose={onClose} wide>
      <ErrorNote error={error} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="col-span-2">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          <span className="label">ECTS</span>
          <input
            type="number"
            min={0}
            max={60}
            className="input"
            value={ects}
            onChange={(e) => {
              const v = Number(e.target.value);
              setEcts(v);
              setTargetHours(v * 30);
            }}
          />
        </label>
        <label>
          <span className="label">Target hours (1 ECTS ≈ 30h)</span>
          <input
            type="number"
            min={0}
            className="input"
            value={targetHours}
            onChange={(e) => setTargetHours(Number(e.target.value))}
          />
        </label>
        <label>
          <span className="label">Color</span>
          <input type="color" className="input h-9 !p-0.5" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="label !mb-0">Lecture slots (feed the gap finder)</span>
        <button
          className="btn-ghost !py-0.5 text-xs"
          onClick={() => setSlots([...slots, { weekday: 1, start_time: '10:00', end_time: '12:00', location: '' }])}
        >
          + slot
        </button>
      </div>
      {slots.map((s, i) => (
        <div key={i} className="mb-1.5 flex items-center gap-1.5">
          <select
            className="input !w-auto"
            value={s.weekday}
            onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}
          >
            {WEEKDAYS.map((d, wi) => (
              <option key={wi} value={wi}>{d}</option>
            ))}
          </select>
          <input
            type="time"
            className="input !w-auto"
            value={s.start_time}
            onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))}
          />
          <input
            type="time"
            className="input !w-auto"
            value={s.end_time}
            onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)))}
          />
          <input
            className="input flex-1"
            placeholder="room"
            value={s.location}
            onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, location: e.target.value } : x)))}
          />
          <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}

      <div className="mt-3 flex items-center gap-2">
        <button className="btn-primary" onClick={() => void save()} disabled={!name.trim()}>
          Save
        </button>
        {course && (
          <button
            className="btn-danger"
            onClick={() => {
              if (confirm(`Delete "${course.name}" and its sessions?`)) {
                void api.del(`/api/study/courses/${course.id}`).then(onChanged);
              }
            }}
          >
            Delete course
          </button>
        )}
      </div>
    </Modal>
  );
}
