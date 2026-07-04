-- v2 Feature 4 — notify-on-disappear watchers (CONTRACT §4.8).
ALTER TABLE watchers
  ADD COLUMN notify_on text NOT NULL DEFAULT 'appear'
  CHECK (notify_on IN ('appear', 'disappear'));
