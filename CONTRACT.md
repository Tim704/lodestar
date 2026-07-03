# Lodestar — Contract v1

**Single source of truth.** Every identifier, route, env var, formula, and constant in the
codebase must match this document literally. When code and contract disagree, the contract wins;
change the contract first, then the code.

Lodestar is a self-hosted, single-instance-per-Pi "student life OS" that unifies six apps
(dynamic to-do, Whenabouts, Study Velocity Tracker, Hoard, Shared Notes, Rosenberg monitor)
into one product: one login, one database, one design system, one Gemini-powered assistant.

---

## 1. Stack

| Layer      | Choice                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| Monorepo   | pnpm workspaces: `server/`, `web/`, `shared/`                            |
| Server     | Node 20+, TypeScript strict ESM, **Fastify 5**                           |
| Database   | **PostgreSQL 16/17**, raw parameterised SQL over one `pg.Pool`, plain-SQL migrations auto-applied at boot |
| Realtime   | `ws` via `@fastify/websocket` + **Yjs** CRDT (notes)                     |
| Auth       | username + password (bcryptjs, cost 10), JWT in an httpOnly cookie       |
| LLM        | **Google Gemini** via REST (`v1beta … :generateContent`), key server-side only, structured JSON + zod validation, heuristic fallback when unconfigured |
| Web        | React 18 + TypeScript + Vite, Tailwind CSS 3, react-router 6, PWA        |
| Scheduler  | in-process 60 s tick loop (single Node process; no external cron)        |
| Deploy     | Docker Compose (app + postgres), arm64-friendly, Cloudflare Tunnel in front |

One Node process serves API + static web build + WebSockets. Low memory is a feature: no ORM,
no framework beyond the above.

## 2. Environment variables

| Var                 | Default                          | Meaning                                          |
| ------------------- | -------------------------------- | ------------------------------------------------ |
| `DATABASE_URL`      | `postgres://lodestar:lodestar@localhost:5433/lodestar` | Postgres connection string |
| `PORT`              | `3000`                           | HTTP port                                        |
| `HOST`              | `0.0.0.0`                        | Bind address                                     |
| `JWT_SECRET`        | dev fallback `lodestar-dev-secret` (warn) | HMAC secret; **required** in production |
| `REGISTRATION_OPEN` | `false`                          | `true` → anyone may register; otherwise first user only, then invite codes |
| `GEMINI_API_KEY`    | *(unset)*                        | unset → heuristic fallbacks everywhere, app fully usable |
| `GEMINI_MODEL`      | `gemini-2.5-flash`               | model id                                         |
| `GEMINI_API_BASE`   | `https://generativelanguage.googleapis.com` | override for proxies                  |
| `GEMINI_TIMEOUT_MS` | `60000`                          | per-call timeout                                 |
| `NTFY_SERVER`       | `https://ntfy.sh`                | push server                                      |
| `NTFY_DEFAULT_TOPIC`| *(unset)*                        | fallback push topic; per-user override in settings |
| `TMDB_API_KEY`      | *(unset)*                        | enables movie/TV search (books/anime/manga are keyless) |
| `DEFAULT_TZ`        | `Europe/Zurich`                  | default IANA zone for new users                  |

## 3. Database schema (tables & key columns)

Migrations live in `server/migrations/NNN_name.sql`, applied in filename order, recorded in
`schema_migrations(name, applied_at)`. IDs are `uuid DEFAULT gen_random_uuid()` unless noted.

- `users` — `username` (unique, lowercased), `display_name`, `password_hash`, `color`, `tz`,
  `is_admin`, `settings jsonb` (`{briefing_hour: 7, ntfy_topic: null}`), `created_at`
- `groups` — `name`, `invite_code` (unique), `created_by`
- `memberships` — `(user_id, group_id)` PK, `role` (`member`|`owner`)
- `tasks` — `user_id`, `title`, `notes`, `importance` (1–10), `cognitive_load` (1–5),
  `duration_min` (≥1), `reasoning`, `enrichment_source` (`gemini`|`heuristic`|`manual`),
  `due_at timestamptz?`, `course_id?`, `source` (`manual`|`capture`|`note`|`watcher`|`study`),
  `source_ref text?`, `is_completed`, `completed_at?`, `created_at`
- `semesters` — `user_id`, `name`, `start_date`, `end_date`, `is_active`
- `courses` — `user_id`, `semester_id`, `name`, `ects int`, `target_hours numeric`
  (default `ects × 30`), `color`
- `lecture_slots` — `course_id`, `weekday int` (0 = Sunday … 6 = Saturday, matching JS `getDay()`),
  `start_time time`, `end_time time`, `location?`
- `study_sessions` — `user_id`, `course_id`, `date date`, `minutes int`, `is_self_study bool`, `note?`
- `events` — `owner_id`, `group_id?` (set → visible to that group), `title`, `description?`,
  `location?`, `all_day bool`, `start_date?/end_date?` (inclusive, all-day) **or**
  `start_utc?/end_utc? timestamptz` (timed), `tz`, `color?`, `icon?`,
  `source` (`manual`|`study_block`), `created_at`
- `terms` — `user_id`, `label`, `kind` (`term`|`break`), `start_date`, `end_date`
- `availability` — `user_id`, `status` (`free`|`busy`|`maybe`), `start_date`, `end_date`, `note?`
- `ical_tokens` — `user_id` PK, `token` (unique, 32-byte hex)
- `note_tabs` — `owner_id`, `group_id?`, `name`, `sort int`, `ydoc bytea?`, `updated_at`
- `note_index` — `note_id text` PK (client-generated within doc), `tab_id`, `title`, `snippet`,
  `is_checklist`, `updated_at` (search/promotion index, refreshed on persist)
- `media_items` — `user_id`, `domain` (`book`|`movie`|`tv`|`anime`|`manga`|`game`|`music`),
  `title`, `creator?`, `year?`, `image_url?`, `description?`, `external_source?`, `external_id?`,
  `status` (`PLANNED`|`CONSUMING`|`COMPLETED`|`DROPPED`|`ON_HOLD`, default `PLANNED`),
  `rating int?` (1–10), `favorite`, `notes?`, `extra jsonb`, `started_at?`, `finished_at?`,
  unique `(user_id, domain, external_id)` when `external_id` set
- `watchers` — `user_id`, `name`, `url`, `mode` (`css`|`regex`), `selector` (CSS selector or JS
  regex source), `exclude_pattern?` (items matching this regex are dropped — e.g. `Belegt`),
  `interval_min int` (≥5, default 30), `active`, `create_task bool`, `task_hint?`,
  `last_run_at?`, `last_status?` (`ok`|`error`), `last_error?`, `state jsonb` (`{known: string[]}`)
- `watcher_hits` — `watcher_id`, `item text`, `seen_at`
- `habits` — `user_id`, `name`, `emoji`, `target_per_day int` (≥1), `unit?`, `color?`, `sort`,
  `archived`
- `habit_logs` — `(habit_id, date)` PK, `count int`
- `notifications` — `user_id`, `type`, `title`, `body?`, `link?`, `read_at?`, `created_at`
- `assistant_docs` — `user_id`, `kind` (`briefing`|`review`), `for_date date`, `content text`
  (markdown), `meta jsonb`, unique `(user_id, kind, for_date)`
- `job_state` — `key text` PK, `value jsonb` (scheduler bookkeeping)

## 4. Formulas (ported verbatim — do not "improve")

### 4.1 Task priority (from dynamicTo-Do `priority.service.ts`)

```
elapsedMinutes = max(1, (now − created_at) in minutes)
base           = (importance × cognitive_load) / ln(elapsedMinutes + duration_min + 2)
score          = base × urgencyMultiplier
```

- `urgencyMultiplier = max(academicMultiplier, deadlineMultiplier)`
- `academicMultiplier` = **1.5** if lowercased title contains any of
  `exam, klausur, prüfung, assignment, proof, project, abgabe`; else 1.0
- `deadlineMultiplier` (Lodestar extension — calendar-aware scoring, integration #1):
  `2.0` if overdue or due < 24 h · `1.7` if due < 48 h · `1.3` if due < 7 d · else `1.0`
- **Starving**: incomplete and `elapsedMinutes > 7 × 24 × 60`
- Sort: score desc, then `created_at` asc, then `id` asc
- **Between lectures** filter: `duration_min ≤ 30 AND cognitive_load ≤ 2`

### 4.2 Enrichment (Gemini, from dynamic-todo `llm.js` + dynamicTo-Do)

Per task title → `{importance: int 1–10, cognitiveLoad: int 1–5, durationMin: int 1–1440,
reasoning: string ≤240}`. Request uses `systemInstruction`, `responseMimeType: application/json`
+ `responseSchema`, key in `x-goog-api-key` header, temperature 0.2, one retry on parse failure,
zod-validated, clamped. STEM/academic → high importance & load; domestic chores → low.
**Heuristic fallback** (no key / LLM error): academic keyword → `{8, 4, 90}`, domestic keyword
(`laundry, dishes, clean, groceries, wäsche, putzen, einkaufen`) → `{3, 1, 30}`,
else `{5, 3, 45}`; `enrichment_source = 'heuristic'`.

### 4.3 Study pacing (from studyHourCounter `studyMath.js`, hours; German grade scale)

```
loggedHours       = Σ session.minutes / 60 (within semester dates)
daysRemaining     = max(1, ceil((semester.end − today)/day) + 1)
requiredVelocity  = max(0, (target_hours − loggedHours) / daysRemaining)   // h/day
roi               = clamp(loggedHours / target_hours × 100, 0, 100)
predictedGrade    = roi ≤ 40 → 5.0
                    40 < roi < 80 → 5.0 − ((roi−40)/40) × 2.0              // → 3.0
                    roi ≥ 80 → 3.0 − normSigmoid((roi−80)/20) × 2.0        // → 1.0
status            = 'on-track' if (roi ≥ 80 AND requiredVelocity ≤ 2) OR requiredVelocity ≤ 4
                    else 'behind'
```

`normSigmoid(t) = (σ((t−0.5)·6) − σ(−3)) / (σ(3) − σ(−3))`, `σ(x) = 1/(1+e^{−x})`.

### 4.4 Overlap / find-a-date (from Whenabouts `dates.ts`, day-granular)

Per person per day: `busy > free > maybe` from explicit availability; with `onlyOnBreak` ON,
no explicit data → `break ⇒ free`, `term ⇒ busy`; otherwise `unknown`. Windows = greedy maximal
contiguous runs where the intersection of daily free-sets keeps `≥ minPeople`; ranked
`freeCount desc, length desc, startDate asc`. Only `free` counts.

### 4.5 Habit streak (from Mizu `app.js`)

Consecutive days ending today where `count ≥ target_per_day`; today not yet met does **not**
break the streak (it just doesn't count).

### 4.6 Lecture gaps (integration #1)

Today's lecture blocks (user's `lecture_slots` where `weekday = today`, within an active
semester) sorted by start; a **gap** is the space between consecutive blocks, 15–240 min.
A task **fits** a gap if `duration_min ≤ gap − 5`.

### 4.7 Auto study tasks (integration #2)

Daily job: for each course with `status = 'behind'`, upsert an open task
`source='study', source_ref=course_id`, title `Study {course}: {deficitHours}h behind pace`,
`importance 8, cognitive_load 4, duration_min 60, enrichment_source 'heuristic'`. Never
duplicated while one is open. `/api/study/blocks` proposes concrete free windows to book;
booking creates an event with `source='study_block'`.

## 5. API routes (all JSON under `/api`, cookie-authed unless noted)

| Area | Routes |
| ---- | ------ |
| meta | `GET /healthz` (public) |
| auth | `POST /api/auth/register` `{username,password,display_name,invite_code?}` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `PATCH /api/auth/me` (display_name, color, tz, settings) |
| groups | `GET /api/groups` · `POST /api/groups` `{name}` · `POST /api/groups/join` `{invite_code}` |
| tasks | `GET /api/tasks?between_lectures=&max_duration=&max_energy=&include_completed=` (scored+sorted) · `POST /api/tasks/smart-add` `{task_names: string[]}` · `POST /api/tasks` (manual full body) · `PATCH /api/tasks/:id` · `POST /api/tasks/:id/toggle` · `DELETE /api/tasks/:id` · `GET /api/tasks/plan` (scored + gap-fit chips) |
| calendar | `GET /api/calendar/events?from=&to=` (own + group) · `POST/PATCH/DELETE /api/calendar/events(/:id)` · same CRUD shape for `/api/calendar/terms` and `/api/calendar/availability` · `GET /api/calendar/find?start_date=&end_date=&min_people=&only_on_break=&group_id=` · `GET /api/calendar/ical-url` · `POST /api/calendar/ical-rotate` · `GET /ical/:token.ics` (public by token) |
| study | CRUD `/api/study/semesters(/:id)` · CRUD `/api/study/courses(/:id)` · `PUT /api/study/courses/:id/slots` (replace list) · `POST /api/study/sessions` · `GET /api/study/sessions?course_id=&limit=` · `DELETE /api/study/sessions/:id` · `GET /api/study/overview?semester_id=` (per-course math of §4.3) · `GET /api/study/blocks` (proposed study blocks) · `POST /api/study/blocks/book` |
| notes | `GET /api/notes/tabs` · `POST /api/notes/tabs` · `PATCH/DELETE /api/notes/tabs/:id` · `WS /ws/notes/:tabId` (yjs sync+awareness) · `POST /api/notes/promote` `{tab_id, note_id, text}` → task |
| media | `GET /api/media?domain=&status=&q=&sort=` · `GET /api/media/search?domain=&q=` (external) · `POST /api/media` · `PATCH/DELETE /api/media/:id` · `POST /api/media/critic` `{domain?}` (Gemini roast) |
| watchers | CRUD `/api/watchers(/:id)` · `POST /api/watchers/:id/run` · `GET /api/watchers/:id/hits` |
| habits | CRUD `/api/habits(/:id)` · `POST /api/habits/:id/log` `{date, delta}` · `GET /api/habits/today` |
| notifications | `GET /api/notifications?unread=` · `POST /api/notifications/read` `{ids?}` (omit = all) |
| assistant | `GET /api/assistant/briefing?date=` (get-or-generate) · `POST /api/assistant/briefing/regenerate` · `GET /api/assistant/review` (ISO week) · `POST /api/assistant/capture` `{text}` → suggestions · `POST /api/assistant/capture/confirm` `{suggestions}` |
| today | `GET /api/today` (composite dashboard: events, lecture blocks, gaps, top tasks, pace warnings, habits, media suggestion, unread count) |
| search | `GET /api/search?q=` → `{tasks, events, notes, media, courses}` (≤8 each) |

Errors: `{error: string}` with 400/401/403/404/409/429/502. Auth cookie: `lodestar_session`,
httpOnly, SameSite=Lax, 30-day JWT `{uid}`.

## 6. The seven integrations (the product)

1. **Calendar-aware scoring** — due dates feed `deadlineMultiplier` (§4.1); `/api/tasks/plan`
   tags tasks that fit today's lecture gaps (§4.6).
2. **Pace → time-blocking** — behind-pace courses auto-create study tasks (§4.7) and
   `/api/study/blocks` proposes bookable free windows.
3. **Notes → tasks** — any checklist item promotes to an enriched task
   (`source='note'`, `source_ref='tabId:noteId'`).
4. **Watcher → task + notification** — new watcher hits notify (ntfy + in-app) and, when
   `create_task`, spawn a task (`source='watcher'`, importance 8, load 1, 15 min).
5. **Backlog suggestions** — free evening (≥120 min after 17:00 with no timed events) or an
   active `break` term → up to 3 `PLANNED` media items on Today.
6. **Assistant** — daily briefing & weekly review (markdown, wry telegram voice — Florence's
   tone; plain template fallback), NL capture → validated task/event/availability suggestions
   the user confirms (never auto-applied).
7. **Notification hub** — every module notifies through one `notify()` (in-app row + optional
   ntfy post); the bell and Today show unread.

## 7. Scheduler (60 s tick, all times in each user's `tz`)

| Job | When | Dedupe |
| --- | ---- | ------ |
| watchers | `last_run_at + interval_min` elapsed | per-watcher `state.known` |
| briefing | local hour = `settings.briefing_hour` (default 7) | `assistant_docs (briefing, local date)` |
| pace check + auto study tasks | daily at local 04:00 | open task per course; `job_state key pace-notified:{courseId}` per date |
| weekly review | Sunday local 17:00 | `assistant_docs (review, ISO-week Monday date)` |

## 8. Design system — "Night Almanac"

Warm-paper almanac in the day, deep-navy observatory at night (`prefers-color-scheme` +
manual toggle persisted in `localStorage.lodestar-theme`). Ink borders (2px), hard offset
shadows (`4px 4px 0`), serif display headings (`"Iowan Old Style", "Palatino Linotype",
Georgia, serif`), system sans body, tabular numerals for stats. The star glyph `✦` is the mark.

CSS custom properties (light → dark): `--paper #f7f2e8 → #141a24` · `--panel #fffbf2 → #1c2433` ·
`--ink #211d14 → #e8e2d4` · `--muted #6b6353 → #9aa4b5` · `--line #d8cdb4 → #32405a` ·
`--gold #b7791f → #d4a03c`. Module accents: tasks `#b7791f`, calendar `#2f7f6f`,
study `#6b5ba5`, notes `#c9a227`, backlog `#b0532f`, watchers `#33718f`, habits `#4a7c43`.

## 9. Notes CRDT layout (one Y.Doc per tab, persisted as a merged update in `note_tabs.ydoc`)

```
doc.getMap('notes')           : Y.Map<noteId, Y.Map>
  note.get('title')           : string            (LWW)
  note.get('body')            : Y.Text            (collaborative)
  note.get('items')           : Y.Array<Y.Map{ id, text: string, checked: boolean }>
  note.get('isChecklist')     : boolean
  note.get('color')           : string | null
  note.get('order')           : number
  note.get('createdAt')       : number (epoch ms; stamped client-side)
```

WS messages use `y-protocols`: `0 = sync`, `1 = awareness`. Server persists debounced (2 s)
and refreshes `note_index`. Docs unload when the last socket closes.

## 10. Ports & deploy

Dev: server `:3000`, Vite `:5173` (proxies `/api`, `/ws`, `/ical`, `/healthz`), dev Postgres
`:5433` (docker-compose.dev.yml). Prod: one container listening on 3000, compose binds
**`127.0.0.1:3030 → 3000`** (adjust to the Pi's 30xx port map), Cloudflare Tunnel points at it.
