# Lodestar — Contract v3

**Single source of truth.** Every identifier, route, env var, formula, and constant in the
codebase must match this document literally. When code and contract disagree, the contract wins;
change the contract first, then the code.

## Changelog

- **v3 (2026-07-04)** — §8 rewritten from the single "Night Almanac" system into a **theming
  contract**: six user-selectable themes (`almanac`, `graphite`, `observatory`, `ephemeris`,
  `riso`, `broadsheet`), each a full token set that may also change **nav layout**
  (sidebar/topbar) and **density** (comfortable/compact). Selection persists in
  `localStorage.lodestar-theme` (legacy `dark`→`observatory`, `light`→`almanac`), applied
  pre-paint via a no-flash inline script setting `data-theme/-density/-nav` on `<html>`.
  `--gold` is retained as an alias of `--accent`.

- **v2 (2026-07-03)** —
  - Watchers: `notify_on ('appear'|'disappear')` + presence tracking; regex watchers now compile
    with flags `gi` (v1 used `g`); W27 dorm preset (§3, §4.8).
  - Habits: optional weekly quotas — `habits.target_per_week`, weekly progress + weeks-in-a-row
    streak (§4.5b), `GET /api/habits/history`.
  - Study: grade projection v2 — `study_sessions.effort`, `courses.target_grade`, effort ×
    consistency adjustment of ROI (§4.3 tail **supersedes v1's raw-ROI grade/status**), advice
    line + `POST /api/study/advice`.
  - Focus sessions: new `focus_sessions` table, AI/heuristic weekly planner (§4.9), timer +
    check-in that logs into `study_sessions` (integration #8), `/api/focus/*` routes, Focus tab,
    Today surfaces the active/next session.
- **v1 (2026-07-03)** — initial contract.

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
  (default `ects × 30`), `target_grade numeric?` (German scale 1.0–5.0; null ⇒ meter targets 1.0),
  `color`
- `lecture_slots` — `course_id`, `weekday int` (0 = Sunday … 6 = Saturday, matching JS `getDay()`),
  `start_time time`, `end_time time`, `location?`
- `study_sessions` — `user_id`, `course_id`, `date date`, `minutes int`, `is_self_study bool`,
  `effort int?` (1–5; null is treated as 3 in §4.3; set manually or by focus check-in), `note?`
- `focus_sessions` — `user_id`, `task_id? → tasks (SET NULL)`, `course_id? → courses (SET NULL)`,
  `goal text`, `planned_minutes int (≥1)`, `scheduled_for timestamptz?`,
  `status ('planned'|'active'|'done'|'abandoned', default 'planned')`,
  `planned_by ('ai'|'manual', default 'manual')`, `started_at?`, `ended_at?`,
  `actual_minutes int? (≥1)`, `completion_pct int? (0–100)`, `checkin_note?`, `created_at`.
  At most **one `active` session per user** (starting a second returns 409).
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
  `notify_on` (`appear`|`disappear`, default `appear` — see §4.8),
  `interval_min int` (≥5, default 30), `active`, `create_task bool`, `task_hint?`,
  `last_run_at?`, `last_status?` (`ok`|`error`), `last_error?`,
  `state jsonb` (`{known: string[], present?: boolean}`)
- `watcher_hits` — `watcher_id`, `item text`, `seen_at`
- `habits` — `user_id`, `name`, `emoji`, `target_per_day int` (≥1),
  `target_per_week int?` (1–7; null = pure daily habit — see §4.5b), `unit?`, `color?`, `sort`,
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

**v2 tail — effort × consistency (supersedes v1's raw-ROI grade & status).** `loggedHours`,
`daysRemaining`, `requiredVelocity`, `roi`, and `deficit` stay exactly as above; then:

```
avgEffort      = mean(effort of in-semester sessions, null effort ⇒ 3); no sessions ⇒ 3
effortScore    = clamp( avgEffort / 3, 0.7, 1.15 )
weeksElapsed   = max(1, ISO weeks (Mon-start) from semester.start_date .. min(today, end_date))
activeWeeks    = of those weeks, how many contain ≥ 3 distinct study days   // consistency_min_days = 3
consistency    = min(1, activeWeeks / weeksElapsed)                          // 0..1
adjustedRoi    = clamp( roi × (0.85 + 0.15 × consistency) × effortScore, 0, 100 )
predictedGrade = v1 piecewise mapping applied to adjustedRoi (not roi)
status         = v1 thresholds computed against adjustedRoi (requiredVelocity unchanged)
```

Constants are literal: `0.7 / 1.15` (effort clamp), `0.85 / 0.15` (consistency base/weight),
`consistency_min_days = 3`. The v1 raw mapping remains exported for the what-if projector as
`gradeFromRoi(roi)`.

**Target proximity (UI meter):** `proximity = clamp((5 − predictedGrade) / (5 − target), 0, 1)`
with `target = courses.target_grade ?? 1.0`.

**Advice line** — every overview row carries a deterministic `advice` string chosen by this
ladder (first match wins):
1. `required_velocity > 4` → `Raw hours are the problem — {rv}h/day needed to close {deficit}h.`
2. `consistency < 0.6 AND roi ≥ 40` → `Hours fine, consistency thin — {idle} idle week(s) dragging you down.`
   (`idle = weeksElapsed − activeWeeks`)
3. `effortScore < 0.9` → `Time is going in, but mostly low-effort sessions — bring the hard problems here.`
4. `status = on-track AND adjustedRoi ≥ 80` → `On course — keep the rhythm.`
5. else → `Steady — {deficit}h to go at {rv}h/day.`

`POST /api/study/advice {course_id}` re-voices the same breakdown through Gemini (Florence's
telegram tone, 1–2 sentences); fallback = the ladder sentence verbatim.

### 4.4 Overlap / find-a-date (from Whenabouts `dates.ts`, day-granular)

Per person per day: `busy > free > maybe` from explicit availability; with `onlyOnBreak` ON,
no explicit data → `break ⇒ free`, `term ⇒ busy`; otherwise `unknown`. Windows = greedy maximal
contiguous runs where the intersection of daily free-sets keeps `≥ minPeople`; ranked
`freeCount desc, length desc, startDate asc`. Only `free` counts.

### 4.5 Habit streak (from Mizu `app.js`)

Consecutive days ending today where `count ≥ target_per_day`; today not yet met does **not**
break the streak (it just doesn't count).

### 4.5b Weekly goals & weeks streak (habits with `target_per_week` set)

Daily behaviour (§4.5) is unchanged. Additionally, for habits with `target_per_week` (1–7):

```
weekly_done  = |{ d ∈ current ISO week (Mon..Sun, user-local) : count(d) ≥ target_per_day }|
week met     = weekly_done(week) ≥ target_per_week
weeks_streak = consecutive met ISO weeks ending at the current week; the in-progress current
               week counts when already met and does NOT break the streak otherwise
               (mirrors §4.5's "today doesn't break it")
```

Graph data: `GET /api/habits/history?habit_id=&weeks=N` (N 1–26, default 12) returns per-day
counts from the Monday `N−1` weeks back through today (`met` = day target reached) plus per-week
`{week_start, done, met}` rows. Rest days are simply not required — 5/5 gym days fill the ring.

### 4.6 Lecture gaps (integration #1)

Today's lecture blocks (user's `lecture_slots` where `weekday = today`, within an active
semester) sorted by start; a **gap** is the space between consecutive blocks, 15–240 min.
A task **fits** a gap if `duration_min ≤ gap − 5`.

### 4.7 Auto study tasks (integration #2)

Daily job: for each course with `status = 'behind'`, upsert an open task
`source='study', source_ref=course_id`, title `Study {course}: {deficitHours}h behind pace`,
`importance 8, cognitive_load 4, duration_min 60, enrichment_source 'heuristic'`. Never
duplicated while one is open. `/api/study/blocks` proposes concrete free windows to book;
booking creates an event with `source='study_block'`. (v2: `status` here is the adjusted
status of §4.3's tail, so consistency/effort feed the auto tasks too.)

### 4.8 Watcher matching & `notify_on`

Extraction is identical for both modes (fetch → CSS/regex items → `exclude_pattern` filter).
**Regex watchers compile with flags `gi`** (v2; v1 used `g`) — banner text matching is
case-insensitive.

- `notify_on = 'appear'` (default, v1 behaviour): new items vs `state.known` → hits + notify +
  optional task; `known` = union (cap 1000).
- `notify_on = 'disappear'`: let `match = items.length > 0` after filtering. Fire exactly on the
  transition `state.present ≠ false → match = false` (an unknown first run against a non-matching
  page fires once — "it's already gone" is information). Then `state.present = match`. On fire:
  one `watcher_hits` row with item `match disappeared`, a `notify()`
  (`{name}: watched text gone`, body includes the URL, priority high), and when `create_task`,
  a task titled `task_hint ?? Check {name}` (importance 8, load 1, 15 min). If the text returns,
  `present` re-arms to `true` and a later disappearance fires again.

**W27 preset** (UI one-click, user-adjustable before save): name `W27 dorm`,
`url = https://www.apartments-hn.de/en/book-apartment/`, `mode = regex`,
`selector = no more units available in W\|27`, `notify_on = disappear`, `interval_min = 30`,
`create_task = true`, `task_hint = Check W27 availability`. (The page renders its unit list via
JS; the static HTML carries the "no more units available in W|27" banner, so we watch the banner.)

### 4.9 Focus planner (Feature: AI-planned focus sessions)

`POST /api/focus/plan {week_start?}` (default: Monday of the current user-local week) gathers:
open tasks with `due_at ≤ week_start + 14d` (incl. overdue), academic-keyword events in the same
window (context only), per-course pace (§4.3 v2), and the week's lecture gaps (§4.6, days ≥ today).
Suggestions are **returned for confirmation, never auto-created** (assistant pattern, §6).

*Heuristic fallback (no key / LLM error):* candidates = tasks ranked by `deadlineMultiplier`
bucket (§4.1) then earliest due, followed by `behind` courses by deficit desc (≤ 2 suggestions
per course). Slots = the week's remaining lecture gaps (≥ 30 min), chronological; block length =
`clamp(min(candidate duration, gap − 5), 25, 60)` min. If the whole week has **zero** gaps,
synthesize one 18:30 / 50-min slot per remaining day. Cap: 8 suggestions.

*Gemini path:* same inputs serialized; the model may only reference provided `task_id` /
`course_id` values; each suggestion is zod-validated + id-membership-checked, minutes clamped
15–180, `scheduled_for` must parse — invalid entries are dropped; empty result falls back to the
heuristic.

## 5. API routes (all JSON under `/api`, cookie-authed unless noted)

| Area | Routes |
| ---- | ------ |
| meta | `GET /healthz` (public) |
| auth | `POST /api/auth/register` `{username,password,display_name,invite_code?}` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `PATCH /api/auth/me` (display_name, color, tz, settings) |
| groups | `GET /api/groups` · `POST /api/groups` `{name}` · `POST /api/groups/join` `{invite_code}` |
| tasks | `GET /api/tasks?between_lectures=&max_duration=&max_energy=&include_completed=` (scored+sorted) · `POST /api/tasks/smart-add` `{task_names: string[]}` · `POST /api/tasks` (manual full body) · `PATCH /api/tasks/:id` · `POST /api/tasks/:id/toggle` · `DELETE /api/tasks/:id` · `GET /api/tasks/plan` (scored + gap-fit chips) |
| calendar | `GET /api/calendar/events?from=&to=` (own + group) · `POST/PATCH/DELETE /api/calendar/events(/:id)` · same CRUD shape for `/api/calendar/terms` and `/api/calendar/availability` · `GET /api/calendar/find?start_date=&end_date=&min_people=&only_on_break=&group_id=` · `GET /api/calendar/ical-url` · `POST /api/calendar/ical-rotate` · `GET /ical/:token.ics` (public by token) |
| study | CRUD `/api/study/semesters(/:id)` · CRUD `/api/study/courses(/:id)` · `PUT /api/study/courses/:id/slots` (replace list) · `POST /api/study/sessions` (accepts `effort?` 1–5) · `GET /api/study/sessions?course_id=&limit=` · `DELETE /api/study/sessions/:id` · `GET /api/study/overview?semester_id=` (per-course math of §4.3 v2, incl. breakdown + `advice`) · `POST /api/study/advice` `{course_id}` (Gemini-voiced, heuristic fallback) · `GET /api/study/blocks` (proposed study blocks) · `POST /api/study/blocks/book` |
| focus | `GET /api/focus?status=` · `POST /api/focus` `{task_id?, course_id?, goal, planned_minutes, scheduled_for?}` · `POST /api/focus/plan` `{week_start?}` → suggestions (§4.9) · `POST /api/focus/plan/confirm` `{suggestions}` → `planned` rows (`planned_by='ai'`) · `POST /api/focus/:id/start` (→ `active`; 409 if another is active) · `POST /api/focus/:id/checkin` `{actual_minutes, completion_pct, note?}` (from `planned`\|`active` → `done`; runs integration #8) · `PATCH /api/focus/:id` (edit `planned` fields; set `status='abandoned'` from `planned`\|`active`) · `DELETE /api/focus/:id` |
| notes | `GET /api/notes/tabs` · `POST /api/notes/tabs` · `PATCH/DELETE /api/notes/tabs/:id` · `WS /ws/notes/:tabId` (yjs sync+awareness) · `POST /api/notes/promote` `{tab_id, note_id, text}` → task |
| media | `GET /api/media?domain=&status=&q=&sort=` · `GET /api/media/search?domain=&q=` (external) · `POST /api/media` · `PATCH/DELETE /api/media/:id` · `POST /api/media/critic` `{domain?}` (Gemini roast) |
| watchers | CRUD `/api/watchers(/:id)` · `POST /api/watchers/:id/run` · `GET /api/watchers/:id/hits` |
| habits | CRUD `/api/habits(/:id)` (accepts `target_per_week?`) · `POST /api/habits/:id/log` `{date, delta}` · `GET /api/habits/today` (adds `target_per_week, weekly_done, weeks_streak`) · `GET /api/habits/history?habit_id=&weeks=` (§4.5b graph data) |
| notifications | `GET /api/notifications?unread=` · `POST /api/notifications/read` `{ids?}` (omit = all) |
| assistant | `GET /api/assistant/briefing?date=` (get-or-generate) · `POST /api/assistant/briefing/regenerate` · `GET /api/assistant/review` (ISO week) · `POST /api/assistant/capture` `{text}` → suggestions · `POST /api/assistant/capture/confirm` `{suggestions}` |
| today | `GET /api/today` (composite dashboard: events, lecture blocks, gaps, top tasks, pace warnings, habits incl. weekly fields, media suggestion, unread count, `focus: {active, next}`) |
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
8. **Focus check-in → study log (the keystone of Feature 1)** — checking in a focus session with
   a `course_id` inserts a `study_sessions` row
   `{course_id, date = user-local today, minutes = actual_minutes, is_self_study = true,
   note = goal, effort = clamp(linked task.cognitive_load, 1, 5) — or 3 when no task}`,
   so focus work flows straight into §4.3 pace, §4.7 auto tasks, and the grade projection.

## 7. Scheduler (60 s tick, all times in each user's `tz`)

| Job | When | Dedupe |
| --- | ---- | ------ |
| watchers | `last_run_at + interval_min` elapsed | per-watcher `state.known` |
| briefing | local hour = `settings.briefing_hour` (default 7) | `assistant_docs (briefing, local date)` |
| pace check + auto study tasks | daily at local 04:00 | open task per course; `job_state key pace-notified:{courseId}` per date |
| weekly review | Sunday local 17:00 | `assistant_docs (review, ISO-week Monday date)` |

## 8. Design system — six selectable themes (v3; supersedes the single-theme v1/v2 §8)

The star glyph `✦` remains the mark and tabular numerals remain mandatory for stats. Everything
else is a **theme**: a complete token set the user picks at runtime. Themes are applied as
`data-theme` / `data-density` / `data-nav` attributes on `<html>`, set **before first paint** by
an inline script in `web/index.html` (no flash), persisted in `localStorage.lodestar-theme`
(legacy values migrate: `dark` → `observatory`, `light` → `almanac`, unknown → `almanac`).
The switcher lives in Settings → Appearance (gallery with live previews) and in the header
(dropdown menu). Theme CSS blocks are written as `[data-theme="<id>"]` (no `html` prefix) so any
element can scope a live preview.

### 8.1 Canonical tokens (every theme MUST define all of these)

| Group | Tokens |
| ----- | ------ |
| palette | `--paper` (page) · `--panel` (surfaces) · `--ink` (text) · `--muted` · `--line` (hairline dividers) · `--edge` (card/control border colour) · `--accent` · `--accent-ink` (text on accent) |
| shape | `--radius` · `--border-w` (card borders) · `--control-w` (buttons/inputs/checkboxes; Tailwind's `border-2` resolves to it) |
| elevation | `--shadow-card` · `--shadow-btn` |
| type | `--font-display` · `--font-body` |
| optional | `--dots` (body dot-grid colour; defaults to `--line`) |

Back-compat: `--gold: var(--accent)` is aliased globally so all existing `*-gold` utilities
re-colour per theme. `.btn-primary` text is `var(--accent-ink)` (never hardcoded white).
`.card` uses `--border-w` verbatim; `.card-flat` (shadowless surfaces) floors it at 1px
(`max(var(--border-w), 1px)`) so borderless themes keep legible list rows.
Dark themes also set `color-scheme: dark` so native form controls follow. Module accents
(`m-tasks` `#b7791f`, `m-calendar` `#2f7f6f`, `m-study` `#6b5ba5`, `m-notes` `#c9a227`,
`m-backlog` `#b0532f`, `m-watchers` `#33718f`, `m-habits` `#4a7c43`) are theme-invariant.

### 8.2 Layout axes

- **nav**: `sidebar` (left rail on md+) or `topbar` (horizontal bar on md+). The mobile bottom
  bar exists in **all** themes below md.
- **density**: `comfortable` (root `font-size: 16px`) or `compact` (root `14px`) — rem-based
  spacing scales the whole app. `riso` additionally sets root `17px` (roomy).

### 8.3 The six themes (exact values)

| id | nav · density | paper | panel | ink | muted | line | edge | accent / accent-ink | radius · border-w · control-w | shadows (card · btn) | type notes |
| -- | ------------- | ----- | ----- | --- | ----- | ---- | ---- | ------------------- | ----------------------------- | -------------------- | ---------- |
| `almanac` | sidebar · comfortable | `#f7f2e8` | `#fffbf2` | `#211d14` | `#6b6353` | `#d8cdb4` | `#211d14` | `#b7791f` / `#ffffff` | 3px · 2px · 2px | `4px 4px 0 var(--ink)` · `2px 2px 0 var(--ink)` | Iowan/Palatino serif display, system sans body |
| `graphite` | topbar · comfortable | `#eef0f3` | `#ffffff` | `#16181d` | `#767c88` | `#e4e6ea` | `#e4e6ea` | `#3a5bd0` / `#ffffff` | 9px · 1px · 1px | `0 1px 2px rgba(16,18,27,.10), 0 6px 20px rgba(16,18,27,.07)` · `0 1px 2px rgba(16,18,27,.12)` | system-ui both; display −0.03em, weight 800 |
| `observatory` | sidebar · comfortable | `#0f1420` | `#1a2233` | `#e7ecf5` | `#93a1ba` | `#2c384f` | `#2c384f` | `#8fb6e6` / `#0e1420` | 9px · 1px · 1px | `0 2px 10px rgba(0,0,0,.45)` · `0 1px 3px rgba(0,0,0,.5)` | system-ui both; `color-scheme: dark`; `--dots #182135` |
| `ephemeris` | topbar · compact | `#080c09` | `#0e130f` | `#b9e8c1` | `#5d7d64` | `#213026` | `#213026` | `#6ee787` / `#08110b` | 0 · 1px · 1px | none · none | monospace both; headings & buttons UPPERCASE (+letter-spacing); `color-scheme: dark` |
| `riso` | sidebar · comfortable (root 17px) | `#f6efe7` | `#ffffff` | `#2f2b28` | `#948a7f` | `#efe6dc` | `#e7ddd2` | `#ec6a53` / `#ffffff` | 16px · 0 · 1px | `0 8px 22px rgba(47,43,40,.13)` · `0 4px 12px rgba(47,43,40,.16)` | system-ui both; borderless cards ride on shadow |
| `broadsheet` | topbar · compact | `#ffffff` | `#ffffff` | `#0a0a0a` | `#5a5a5a` | `#0a0a0a` | `#0a0a0a` | `#ff4a1c` / `#ffffff` | 0 · 3px · 3px | `7px 7px 0 #0a0a0a` · `3px 3px 0 #0a0a0a` | Helvetica/Arial both; headings heavy UPPERCASE; all `.btn` borders `var(--ink)`; `--dots #ececec` |

The theme registry (`web/src/themes.ts`) carries `{id, label, vibe, nav, density, dark}` only —
token values live solely in CSS; previews re-scope them with a `data-theme` attribute.

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
