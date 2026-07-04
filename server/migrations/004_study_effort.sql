-- v2 Feature 3 — grade projection v2 inputs (CONTRACT §4.3 tail).
ALTER TABLE study_sessions
  ADD COLUMN effort int
  CHECK (effort BETWEEN 1 AND 5); -- null is treated as 3

ALTER TABLE courses
  ADD COLUMN target_grade numeric
  CHECK (target_grade >= 1 AND target_grade <= 5); -- German scale; null => meter targets 1.0
