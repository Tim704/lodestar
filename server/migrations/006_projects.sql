-- v4 — the Projects module (CONTRACT §3, §4.12) + tasks.project_id.

CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  blurb       text,
  status      text NOT NULL DEFAULT 'idea'
              CHECK (status IN ('idea', 'active', 'paused', 'shipped', 'shelved')),
  next_action text,
  repo_url    text,
  live_url    text,
  color       text,
  tags        text[] NOT NULL DEFAULT '{}',
  pinned      boolean NOT NULL DEFAULT false,
  sort        int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_status ON projects (user_id, status);

ALTER TABLE tasks ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX tasks_project ON tasks (project_id) WHERE project_id IS NOT NULL;

-- task source gains 'project'
ALTER TABLE tasks DROP CONSTRAINT tasks_source_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual', 'capture', 'note', 'watcher', 'study', 'project'));
