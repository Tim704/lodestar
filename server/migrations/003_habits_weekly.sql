-- v2 Feature 2 — weekly habit quotas (CONTRACT §4.5b). NULL = pure daily habit.
ALTER TABLE habits
  ADD COLUMN target_per_week int
  CHECK (target_per_week BETWEEN 1 AND 7);
