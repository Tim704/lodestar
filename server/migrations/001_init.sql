-- Lodestar schema v1 — CONTRACT §3. gen_random_uuid() is core in PG 13+.

-- ── auth ─────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  color         text NOT NULL DEFAULT '#b7791f',
  tz            text NOT NULL DEFAULT 'Europe/Zurich',
  is_admin      boolean NOT NULL DEFAULT false,
  settings      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

CREATE TABLE groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  invite_code text NOT NULL UNIQUE,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role     text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'owner')),
  PRIMARY KEY (user_id, group_id)
);

-- ── study (before tasks: tasks.course_id references courses) ────────────────

CREATE TABLE semesters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  CHECK (start_date <= end_date)
);
CREATE INDEX semesters_user ON semesters (user_id);

CREATE TABLE courses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semester_id  uuid NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name         text NOT NULL,
  ects         int NOT NULL DEFAULT 0 CHECK (ects >= 0),
  target_hours numeric NOT NULL DEFAULT 0 CHECK (target_hours >= 0),
  color        text
);
CREATE INDEX courses_user ON courses (user_id);
CREATE INDEX courses_semester ON courses (semester_id);

CREATE TABLE lecture_slots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  weekday    int NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sunday (JS getDay())
  start_time time NOT NULL,
  end_time   time NOT NULL,
  location   text,
  CHECK (start_time < end_time)
);
CREATE INDEX lecture_slots_course ON lecture_slots (course_id);

CREATE TABLE study_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  date          date NOT NULL,
  minutes       int NOT NULL CHECK (minutes > 0),
  is_self_study boolean NOT NULL DEFAULT true,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_sessions_user_date ON study_sessions (user_id, date);
CREATE INDEX study_sessions_course ON study_sessions (course_id);

-- ── tasks ────────────────────────────────────────────────────────────────────

CREATE TABLE tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             text NOT NULL,
  notes             text,
  importance        int NOT NULL CHECK (importance BETWEEN 1 AND 10),
  cognitive_load    int NOT NULL CHECK (cognitive_load BETWEEN 1 AND 5),
  duration_min      int NOT NULL CHECK (duration_min >= 1),
  reasoning         text,
  enrichment_source text NOT NULL DEFAULT 'heuristic'
                    CHECK (enrichment_source IN ('gemini', 'heuristic', 'manual')),
  due_at            timestamptz,
  course_id         uuid REFERENCES courses(id) ON DELETE SET NULL,
  source            text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'capture', 'note', 'watcher', 'study')),
  source_ref        text,
  is_completed      boolean NOT NULL DEFAULT false,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_user_open ON tasks (user_id) WHERE NOT is_completed;
CREATE INDEX tasks_source_ref ON tasks (user_id, source, source_ref) WHERE NOT is_completed;

-- ── calendar ────────────────────────────────────────────────────────────────

CREATE TABLE events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id    uuid REFERENCES groups(id) ON DELETE SET NULL,
  title       text NOT NULL,
  description text,
  location    text,
  all_day     boolean NOT NULL,
  start_date  date,
  end_date    date,
  start_utc   timestamptz,
  end_utc     timestamptz,
  tz          text NOT NULL DEFAULT 'Europe/Zurich',
  color       text,
  icon        text,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'study_block')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (all_day AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_date <= end_date)
    OR (NOT all_day AND start_utc IS NOT NULL AND end_utc IS NOT NULL AND start_utc <= end_utc)
  )
);
CREATE INDEX events_owner ON events (owner_id);
CREATE INDEX events_group ON events (group_id) WHERE group_id IS NOT NULL;

CREATE TABLE terms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('term', 'break')),
  start_date date NOT NULL,
  end_date   date NOT NULL,
  CHECK (start_date <= end_date)
);
CREATE INDEX terms_user ON terms (user_id);

CREATE TABLE availability (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('free', 'busy', 'maybe')),
  start_date date NOT NULL,
  end_date   date NOT NULL,
  note       text,
  CHECK (start_date <= end_date)
);
CREATE INDEX availability_user ON availability (user_id);

CREATE TABLE ical_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token   text NOT NULL UNIQUE
);

-- ── notes ────────────────────────────────────────────────────────────────────

CREATE TABLE note_tabs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id   uuid REFERENCES groups(id) ON DELETE SET NULL,
  name       text NOT NULL,
  sort       int NOT NULL DEFAULT 0,
  ydoc       bytea,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX note_tabs_owner ON note_tabs (owner_id);

CREATE TABLE note_index (
  note_id      text PRIMARY KEY,
  tab_id       uuid NOT NULL REFERENCES note_tabs(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT '',
  snippet      text NOT NULL DEFAULT '',
  is_checklist boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX note_index_tab ON note_index (tab_id);

-- ── media / backlog ─────────────────────────────────────────────────────────

CREATE TABLE media_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain          text NOT NULL
                  CHECK (domain IN ('book', 'movie', 'tv', 'anime', 'manga', 'game', 'music')),
  title           text NOT NULL,
  creator         text,
  year            int,
  image_url       text,
  description     text,
  external_source text,
  external_id     text,
  status          text NOT NULL DEFAULT 'PLANNED'
                  CHECK (status IN ('PLANNED', 'CONSUMING', 'COMPLETED', 'DROPPED', 'ON_HOLD')),
  rating          int CHECK (rating BETWEEN 1 AND 10),
  favorite        boolean NOT NULL DEFAULT false,
  notes           text,
  extra           jsonb NOT NULL DEFAULT '{}',
  started_at      date,
  finished_at     date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_user_domain ON media_items (user_id, domain);
CREATE UNIQUE INDEX media_user_external
  ON media_items (user_id, domain, external_id) WHERE external_id IS NOT NULL;

-- ── watchers ────────────────────────────────────────────────────────────────

CREATE TABLE watchers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  url             text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('css', 'regex')),
  selector        text NOT NULL,
  exclude_pattern text,
  interval_min    int NOT NULL DEFAULT 30 CHECK (interval_min >= 5),
  active          boolean NOT NULL DEFAULT true,
  create_task     boolean NOT NULL DEFAULT false,
  task_hint       text,
  last_run_at     timestamptz,
  last_status     text CHECK (last_status IN ('ok', 'error')),
  last_error      text,
  state           jsonb NOT NULL DEFAULT '{"known": []}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX watchers_user ON watchers (user_id);

CREATE TABLE watcher_hits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watcher_id uuid NOT NULL REFERENCES watchers(id) ON DELETE CASCADE,
  item       text NOT NULL,
  seen_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX watcher_hits_watcher ON watcher_hits (watcher_id, seen_at DESC);

-- ── habits ──────────────────────────────────────────────────────────────────

CREATE TABLE habits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  emoji          text NOT NULL DEFAULT '✦',
  target_per_day int NOT NULL DEFAULT 1 CHECK (target_per_day >= 1),
  unit           text,
  color          text,
  sort           int NOT NULL DEFAULT 0,
  archived       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX habits_user ON habits (user_id) WHERE NOT archived;

CREATE TABLE habit_logs (
  habit_id uuid NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date     date NOT NULL,
  count    int NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (habit_id, date)
);

-- ── notifications / assistant / jobs ────────────────────────────────────────

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE assistant_docs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('briefing', 'review')),
  for_date   date NOT NULL,
  content    text NOT NULL,
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, for_date)
);

CREATE TABLE job_state (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
