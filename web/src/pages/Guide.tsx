// The Guide (CONTRACT §8.4) — a plain-language tour of everything. Static,
// no API, mobile-first, and the most-read page on a phone. Auto-opens once
// per device via localStorage.lodestar-guide-seen.

import { useEffect } from 'react';
import { Link } from 'react-router-dom';

interface Section {
  id: string;
  glyph: string;
  accent: string; // tailwind text class
  title: string;
  to?: string; // deep link
  body: React.ReactNode;
}

function Nice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-sm">
      <b>The nice thing:</b> {children}
    </p>
  );
}

const SECTIONS: Section[] = [
  {
    id: 'fortnight',
    glyph: '✦',
    accent: 'text-gold',
    title: 'The two-week view (home)',
    to: '/',
    body: (
      <>
        <p className="text-sm">
          Your next 14 days on one screen: classes, deadlines, and events. Today is highlighted,
          exams are marked ▲, and anything due soon gets a red chip. Tap any day to see it in
          detail — or to add a task due that day.
        </p>
        <Nice>it fills itself in. Set up your courses once and every week just appears.</Nice>
      </>
    ),
  },
  {
    id: 'overview',
    glyph: '◎',
    accent: 'text-gold',
    title: 'Overview',
    to: '/overview',
    body: (
      <>
        <p className="text-sm">
          Everything at a glance: your morning telegram (a short wry note about the day), the top
          of your task list, study warnings, habits to tick off, and what's worth doing tonight.
        </p>
        <Nice>the telegram writes itself every morning — check the bell when it arrives.</Nice>
      </>
    ),
  },
  {
    id: 'tasks',
    glyph: '◈',
    accent: 'text-m-tasks',
    title: 'Tasks',
    to: '/tasks',
    body: (
      <>
        <p className="text-sm">
          Just type what you need to do, one line each — "finish maths sheet", "book dentist".
          Lodestar guesses how hard, how urgent, and how long each one is, then hands you the
          order to do them in. No forms to fill.
        </p>
        <Nice>
          the <i>between lectures</i> filter shows only quick, low-effort wins — perfect for a
          45-minute gap.
        </Nice>
      </>
    ),
  },
  {
    id: 'focus',
    glyph: '◐',
    accent: 'text-m-study',
    title: 'Focus',
    to: '/focus',
    body: (
      <>
        <p className="text-sm">
          Big task feeling vague? Give it a tiny goal — "Questions 1–3, 45 minutes" — hit start,
          and work to the timer. When it's done you say how far you got, and Lodestar quietly logs
          the time to that course. "Plan my week" proposes a whole week of sessions you can accept
          or reject.
        </p>
        <Nice>
          that logged time moves your grade projection, so focused work actually shows up on your
          Study page.
        </Nice>
      </>
    ),
  },
  {
    id: 'projects',
    glyph: '⚑',
    accent: 'text-m-projects',
    title: 'Projects',
    to: '/projects',
    body: (
      <>
        <p className="text-sm">
          Your side projects, from shower-thought to shipped. Dump ideas in the first column,
          promote one when you start, and park the rest without guilt. Each project holds its own
          little task list.
        </p>
        <Nice>
          "suggest next steps" turns a vague idea into three concrete first tasks — you approve
          them before anything is created.
        </Nice>
      </>
    ),
  },
  {
    id: 'study',
    glyph: '△',
    accent: 'text-m-study',
    title: 'Study',
    to: '/study',
    body: (
      <>
        <p className="text-sm">
          Your courses, your class times, and an honest answer to "am I on track?". Log study
          time (or let Focus do it), and Lodestar shows how many hours a day you'd need to hit
          your target — and the grade you're currently trending toward.
        </p>
        <Nice>
          the grade number is explainable: open "grade breakdown" and it shows exactly how hours,
          consistency, and effort combine — no magic.
        </Nice>
      </>
    ),
  },
  {
    id: 'calendar',
    glyph: '☾',
    accent: 'text-m-calendar',
    title: 'Calendar',
    to: '/calendar',
    body: (
      <>
        <p className="text-sm">
          The full planner: a month view, events you can share with your group, terms and
          holidays, and marking when you're away. "Find a date" scans everyone's availability and
          tells you the best stretch where enough of you are free.
        </p>
        <Nice>
          there's a private calendar-feed link in Settings — subscribe from Google or Apple
          Calendar and everything shows up there too.
        </Nice>
      </>
    ),
  },
  {
    id: 'notes',
    glyph: '❏',
    accent: 'text-m-notes',
    title: 'Notes',
    to: '/notes',
    body: (
      <>
        <p className="text-sm">
          Shared sticky notes that update live — you can literally watch a friend type. Make tabs
          for anything ("Ideas", "Shopping", "Trip"), turn a note into a checklist, tint it a
          colour.
        </p>
        <Nice>
          hover a checklist item and hit <span className="text-m-tasks">◈→</span> — it becomes a
          real, scored task on your list.
        </Nice>
      </>
    ),
  },
  {
    id: 'backlog',
    glyph: '☰',
    accent: 'text-m-backlog',
    title: 'Backlog',
    to: '/backlog',
    body: (
      <>
        <p className="text-sm">
          Everything you mean to read, watch, and play — books, films, TV, anime, manga, games,
          music — with statuses and your own ratings. Search finds covers and details for you.
        </p>
        <Nice>
          "consult the critic" reviews your pile and (gently) roasts you, then tells you what to
          start next. Free evenings surface suggestions on the Overview by themselves.
        </Nice>
      </>
    ),
  },
  {
    id: 'watchers',
    glyph: '◉',
    accent: 'text-m-watchers',
    title: 'Watchers',
    to: '/watchers',
    body: (
      <>
        <p className="text-sm">
          Point one at any web page and get pinged when it changes — an apartment opening up,
          course seats, grades going live. They can watch for something <i>appearing</i> or for a
          "nothing available" banner <i>disappearing</i>.
        </p>
        <Nice>
          a watcher can also drop a ready-made task on your list ("Check W27 availability") the
          moment it fires.
        </Nice>
      </>
    ),
  },
  {
    id: 'habits',
    glyph: '✚',
    accent: 'text-m-habits',
    title: 'Habits',
    to: '/overview',
    body: (
      <>
        <p className="text-sm">
          Daily counters with streaks — water, gym, reading. They live on the Overview (tap + as
          you go) and you manage them in Settings. Habits with rest days get a weekly quota
          instead: gym 5×/week keeps its streak over the weekend.
        </p>
        <Nice>tap a habit's name to see a 12-week heatmap of how you've actually done.</Nice>
      </>
    ),
  },
];

const CONNECTIONS: Array<[string, string]> = [
  ['A task got more urgent on its own?', 'Deadlines bump tasks up the list as they get close.'],
  ['A "Study X" task appeared overnight?', "You fell behind pace in that course — it's a nudge, with bookable study blocks to match."],
  ['A checklist tick became a task?', 'You pressed ◈→ on a note item — notes feed the task list.'],
  ['A task appeared after a ping?', 'A watcher fired and was set to create one.'],
  ['Your projected grade moved?', 'A focus check-in logged study time, which feeds the projection.'],
  ['Film suggestions tonight?', "Your evening looks free (or you're on a break) — the backlog steps forward."],
];

export default function GuidePage() {
  useEffect(() => {
    localStorage.setItem('lodestar-guide-seen', '1');
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-1 flex items-start justify-between gap-2">
        <h1 className="h-display text-3xl">? The Guide</h1>
        <Link to="/" className="btn-ghost !py-1 text-xs">
          Skip the tour →
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted">
        Lodestar in plain words — what each part does and why things happen. Two minutes, no
        jargon.
      </p>

      {/* start here */}
      <section className="card mb-4 border-gold p-4">
        <h2 className="h-display mb-2 text-lg">Start here — five steps</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>
            Open <Link className="underline" to="/study">Study</Link> and add a semester, your
            courses, and their class times.
          </li>
          <li>
            That's it for setup — your <Link className="underline" to="/">two-week view</Link>{' '}
            now fills in with every class, automatically.
          </li>
          <li>
            Add a few <Link className="underline" to="/tasks">tasks</Link>. Just type them —
            Lodestar sorts out how urgent and how big they are.
          </li>
          <li>
            Pick a look in <Link className="underline" to="/settings">Settings → Appearance</Link>{' '}
            (six themes; some even move the navigation around).
          </li>
          <li>
            Optional: set a notification topic in Settings so your phone gets pinged — and install
            Lodestar to your home screen while you're there.
          </li>
        </ol>
      </section>

      {/* toc */}
      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Guide contents">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="chip hover:shadow-almanac-sm">
            <span className={s.accent}>{s.glyph}</span> {s.title.split(' (')[0]}
          </a>
        ))}
        <a href="#connections" className="chip hover:shadow-almanac-sm">
          ⇄ How it connects
        </a>
        <a href="#handy" className="chip hover:shadow-almanac-sm">
          ⌘ Handy
        </a>
      </nav>

      {/* modules */}
      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="card scroll-mt-4 p-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <h2 className="h-display text-lg">
                <span className={`mr-1.5 ${s.accent}`}>{s.glyph}</span>
                {s.title}
              </h2>
              {s.to && (
                <Link to={s.to} className="whitespace-nowrap text-xs text-muted underline">
                  open →
                </Link>
              )}
            </div>
            {s.body}
          </section>
        ))}

        {/* connections */}
        <section id="connections" className="card scroll-mt-4 p-4">
          <h2 className="h-display mb-1.5 text-lg">⇄ How it all connects</h2>
          <p className="mb-2 text-sm text-muted">
            The whole point of one app instead of ten: the parts talk to each other. If something
            happens "by itself", it's one of these:
          </p>
          <ul className="space-y-1.5 text-sm">
            {CONNECTIONS.map(([q, a]) => (
              <li key={q}>
                <b>{q}</b> {a}
              </li>
            ))}
          </ul>
        </section>

        {/* handy */}
        <section id="handy" className="card scroll-mt-4 p-4">
          <h2 className="h-display mb-1.5 text-lg">⌘ Handy to know</h2>
          <ul className="space-y-1.5 text-sm">
            <li>
              <b>Search everything:</b> press <kbd className="chip !px-1">Ctrl K</kbd> (or the ⌘
              button) — tasks, events, notes, backlog, courses.
            </li>
            <li>
              <b>Capture in plain English:</b> in that same box, start with <b>+</b> — like{' '}
              <i>"+ email prof by friday, important"</i> — and it becomes a task with a due date.
              You approve it first; nothing is created behind your back.
            </li>
            <li>
              <b>Themes:</b> the ◧ menu in the header, or Settings → Appearance. Six looks, from
              warm paper to a green terminal.
            </li>
            <li>
              <b>On your phone:</b> install it from Settings → "On your phone" — full screen, home
              screen icon, feels native.
            </li>
            <li>
              <b>Weekly review:</b> every Sunday evening a review of your week lands in ✉ — what
              got done, what slipped, one suggestion.
            </li>
          </ul>
          <p className="mt-3 border-t border-line pt-2 text-xs text-muted">
            <b className="text-ink">Works without AI:</b> everything here runs with no API key at
            all. Adding a Gemini key in the server settings just makes the briefings, suggestions,
            and the critic smarter — it never changes what you can do.
          </p>
        </section>
      </div>

      <div className="mt-4 text-center">
        <Link to="/" className="btn-primary">
          ✦ Take me to my fortnight
        </Link>
      </div>
    </div>
  );
}
