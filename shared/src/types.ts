// Wire types — the JSON shapes the API speaks (snake_case, matching SQL).
// CONTRACT §3/§5. Dates: YYYY-MM-DD strings; instants: ISO-8601 UTC strings.

import type { DeadlineBucket } from './priority.js';
import type { CoursePaceV2 } from './velocity.js';
import type { OverlapResult } from './overlap.js';

// ── auth ────────────────────────────────────────────────────────────────────

export interface UserSettings {
  briefing_hour: number; // local hour 0-23, default 7
  ntfy_topic: string | null;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  color: string;
  tz: string;
  is_admin: boolean;
  settings: UserSettings;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  invite_code: string;
  members: Array<Pick<User, 'id' | 'display_name' | 'color'>>;
}

// ── tasks ───────────────────────────────────────────────────────────────────

export type EnrichmentSource = 'gemini' | 'heuristic' | 'manual';
export type TaskSource = 'manual' | 'capture' | 'note' | 'watcher' | 'study' | 'project';

export interface Task {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  importance: number;
  cognitive_load: number;
  duration_min: number;
  reasoning: string | null;
  enrichment_source: EnrichmentSource;
  due_at: string | null;
  course_id: string | null;
  project_id: string | null;
  source: TaskSource;
  source_ref: string | null;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
}

export interface PrioritizedTask extends Task {
  priority_score: number;
  is_starving: boolean;
  urgency_multiplier: number;
  deadline_bucket: DeadlineBucket;
  fits_gap?: GapInfo | null;
}

export interface GapInfo {
  start: string; // HH:MM local
  end: string;
  minutes: number;
  after_course: string;
  before_course: string;
}

// ── study ───────────────────────────────────────────────────────────────────

export interface Semester {
  id: string;
  user_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface Course {
  id: string;
  user_id: string;
  semester_id: string;
  name: string;
  ects: number;
  target_hours: number;
  target_grade: number | null; // German scale 1.0–5.0; null ⇒ meter targets 1.0
  color: string | null;
}

export interface LectureSlot {
  id: string;
  course_id: string;
  weekday: number; // 0=Sunday … 6=Saturday (JS getDay())
  start_time: string; // HH:MM
  end_time: string;
  location: string | null;
}

export interface StudySession {
  id: string;
  user_id: string;
  course_id: string;
  date: string;
  minutes: number;
  is_self_study: boolean;
  effort: number | null; // 1–5; null ⇒ 3 (§4.3 v2)
  note: string | null;
}

export interface CourseOverview extends Course {
  pace: CoursePaceV2;
  slots: LectureSlot[];
}

export interface StudyBlockProposal {
  date: string;
  start: string; // HH:MM local
  end: string;
  minutes: number;
  course_id: string;
  course_name: string;
  reason: string;
}

// ── calendar ────────────────────────────────────────────────────────────────

export type EventSource = 'manual' | 'study_block';

export interface CalendarEvent {
  id: string;
  owner_id: string;
  group_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  start_utc: string | null;
  end_utc: string | null;
  tz: string;
  color: string | null;
  icon: string | null;
  source: EventSource;
  owner_name?: string;
  owner_color?: string;
}

export interface Term {
  id: string;
  user_id: string;
  label: string;
  kind: 'term' | 'break';
  start_date: string;
  end_date: string;
  user_name?: string;
  user_color?: string;
}

export interface AvailabilityEntry {
  id: string;
  user_id: string;
  status: 'free' | 'busy' | 'maybe';
  start_date: string;
  end_date: string;
  note: string | null;
  user_name?: string;
  user_color?: string;
}

export type FindDateResult = OverlapResult;

// ── notes ───────────────────────────────────────────────────────────────────

export interface NoteTab {
  id: string;
  owner_id: string;
  group_id: string | null;
  name: string;
  sort: number;
}

// ── media / backlog ─────────────────────────────────────────────────────────

export type MediaDomain = 'book' | 'movie' | 'tv' | 'anime' | 'manga' | 'game' | 'music';
export type MediaStatus = 'PLANNED' | 'CONSUMING' | 'COMPLETED' | 'DROPPED' | 'ON_HOLD';

export const MEDIA_DOMAINS: MediaDomain[] = [
  'book',
  'movie',
  'tv',
  'anime',
  'manga',
  'game',
  'music',
];

export interface MediaItem {
  id: string;
  user_id: string;
  domain: MediaDomain;
  title: string;
  creator: string | null;
  year: number | null;
  image_url: string | null;
  description: string | null;
  external_source: string | null;
  external_id: string | null;
  status: MediaStatus;
  rating: number | null;
  favorite: boolean;
  notes: string | null;
  extra: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface MediaSearchResult {
  domain: MediaDomain;
  title: string;
  creator: string | null;
  year: number | null;
  image_url: string | null;
  description: string | null;
  external_source: string;
  external_id: string;
  extra?: Record<string, unknown>;
}

// ── watchers ────────────────────────────────────────────────────────────────

export interface Watcher {
  id: string;
  user_id: string;
  name: string;
  url: string;
  mode: 'css' | 'regex';
  selector: string;
  exclude_pattern: string | null;
  notify_on: 'appear' | 'disappear';
  interval_min: number;
  active: boolean;
  create_task: boolean;
  task_hint: string | null;
  last_run_at: string | null;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
  known_count: number;
}

export interface WatcherHit {
  id: string;
  watcher_id: string;
  item: string;
  seen_at: string;
}

// ── habits ──────────────────────────────────────────────────────────────────

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  target_per_day: number;
  target_per_week: number | null; // 1–7; null = pure daily habit (§4.5b)
  unit: string | null;
  color: string | null;
  sort: number;
  archived: boolean;
}

export interface HabitToday extends Habit {
  today_count: number;
  streak: number;
  days_met: number;
  weekly_done: number | null; // §4.5b — null when target_per_week is null
  weeks_streak: number | null;
}

export interface HabitHistoryDay {
  date: string;
  count: number;
  met: boolean;
}

export interface HabitHistoryWeek {
  week_start: string;
  done: number;
  met: boolean | null; // null when no weekly target
}

export interface HabitHistory {
  habit_id: string;
  target_per_day: number;
  target_per_week: number | null;
  days: HabitHistoryDay[];
  weeks: HabitHistoryWeek[];
}

// ── projects (§4.12, integration #9) ────────────────────────────────────────

export type ProjectStatus = 'idea' | 'active' | 'paused' | 'shipped' | 'shelved';

export const PROJECT_STATUSES: ProjectStatus[] = [
  'idea',
  'active',
  'paused',
  'shipped',
  'shelved',
];

export interface Project {
  id: string;
  user_id: string;
  name: string;
  blurb: string | null;
  status: ProjectStatus;
  next_action: string | null;
  repo_url: string | null;
  live_url: string | null;
  color: string | null;
  tags: string[];
  pinned: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
  open_tasks?: number; // list join
}

export interface ProjectSuggestion {
  title: string;
  reason?: string | null;
}

// ── fortnight (§4.11 — the home page) ──────────────────────────────────────

export interface FortnightTask {
  id: string;
  title: string;
  is_completed: boolean;
  duration_min: number;
  course_id: string | null;
  project_id: string | null;
  deadline_bucket: DeadlineBucket;
}

export interface FortnightEvent extends CalendarEvent {
  is_exam: boolean;
}

export interface FortnightDay {
  date: string;
  classes: LectureBlock[];
  due_tasks: FortnightTask[];
  events: FortnightEvent[];
}

export interface FortnightPayload {
  start: string;
  days: FortnightDay[];
}

// ── focus sessions (§4.9, integration #8) ──────────────────────────────────

export type FocusStatus = 'planned' | 'active' | 'done' | 'abandoned';

export interface FocusSession {
  id: string;
  user_id: string;
  task_id: string | null;
  course_id: string | null;
  goal: string;
  planned_minutes: number;
  scheduled_for: string | null;
  status: FocusStatus;
  planned_by: 'ai' | 'manual';
  started_at: string | null;
  ended_at: string | null;
  actual_minutes: number | null;
  completion_pct: number | null;
  checkin_note: string | null;
  created_at: string;
  // display joins
  task_title?: string | null;
  course_name?: string | null;
  course_color?: string | null;
}

export interface FocusPlanSuggestion {
  course_id: string | null;
  task_id: string | null;
  goal: string;
  planned_minutes: number;
  scheduled_for: string | null; // UTC ISO instant
  reason?: string;
  // display-only enrichment from the server; confirm sends ids
  course_name?: string | null;
  task_title?: string | null;
}

// ── notifications / assistant ───────────────────────────────────────────────

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AssistantDoc {
  id: string;
  kind: 'briefing' | 'review';
  for_date: string;
  content: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export type CaptureSuggestion =
  | { kind: 'task'; label: string; payload: { title: string; due_at: string | null; notes: string | null } }
  | {
      kind: 'event';
      label: string;
      payload: {
        title: string;
        all_day: boolean;
        start_date: string | null;
        end_date: string | null;
        start_utc: string | null;
        end_utc: string | null;
        icon: string | null;
      };
    }
  | {
      kind: 'availability';
      label: string;
      payload: { status: 'free' | 'busy' | 'maybe'; start_date: string; end_date: string; note: string | null };
    };

// ── today / dashboard ───────────────────────────────────────────────────────

export interface LectureBlock {
  course_id: string;
  course_name: string;
  color: string | null;
  start: string; // HH:MM
  end: string;
  location: string | null;
}

export interface PaceWarning {
  course_id: string;
  course_name: string;
  deficit_hours: number;
  required_velocity: number;
  predicted_grade: number;
}

export interface TodayPayload {
  date: string;
  events: CalendarEvent[];
  lecture_blocks: LectureBlock[];
  gaps: GapInfo[];
  top_tasks: PrioritizedTask[];
  pace_warnings: PaceWarning[];
  habits: HabitToday[];
  media_suggestions: MediaItem[];
  media_reason: string | null;
  unread_notifications: number;
  briefing: AssistantDoc | null;
  on_break: boolean;
  focus: {
    active: FocusSession | null;
    next: FocusSession | null;
  };
  projects: {
    active_count: number;
    stale: { id: string; name: string; days_quiet: number } | null;
  };
}

// ── search ──────────────────────────────────────────────────────────────────

export interface SearchResults {
  tasks: Array<Pick<Task, 'id' | 'title' | 'is_completed'>>;
  events: Array<Pick<CalendarEvent, 'id' | 'title' | 'start_date' | 'start_utc'>>;
  notes: Array<{ note_id: string; tab_id: string; title: string; snippet: string }>;
  media: Array<Pick<MediaItem, 'id' | 'title' | 'domain' | 'status'>>;
  courses: Array<Pick<Course, 'id' | 'name'>>;
}
