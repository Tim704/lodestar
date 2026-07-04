-- v2 Feature 1 — focus sessions (CONTRACT §3, §4.9, integration #8).
CREATE TABLE focus_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE SET NULL,
  course_id       uuid REFERENCES courses(id) ON DELETE SET NULL,
  goal            text NOT NULL,
  planned_minutes int NOT NULL CHECK (planned_minutes >= 1),
  scheduled_for   timestamptz,
  status          text NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned', 'active', 'done', 'abandoned')),
  planned_by      text NOT NULL DEFAULT 'manual' CHECK (planned_by IN ('ai', 'manual')),
  started_at      timestamptz,
  ended_at        timestamptz,
  actual_minutes  int CHECK (actual_minutes >= 1),
  completion_pct  int CHECK (completion_pct BETWEEN 0 AND 100),
  checkin_note    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX focus_user_status ON focus_sessions (user_id, status);
CREATE INDEX focus_user_sched ON focus_sessions (user_id, scheduled_for);
