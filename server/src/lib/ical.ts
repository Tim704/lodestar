// RFC 5545 VCALENDAR builder — ported from Whenabouts src/server/lib/ical.ts
// (recurrence trimmed; Lodestar v1 has no recurring events).
import { DateTime } from 'luxon';

export interface IcsItem {
  uid: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  allDay: boolean;
  /** Inclusive YYYY-MM-DD when allDay. */
  startDate?: string | null;
  endDate?: string | null;
  /** UTC ISO when timed. */
  startUtc?: string | null;
  endUtc?: string | null;
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold lines to 75 octets per RFC 5545 (continuation lines start with a space). */
function fold(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > 73) {
      out.push(cur);
      cur = ' ' + ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out.join('\r\n');
}

function utcStamp(iso: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function dateValue(date: string): string {
  return DateTime.fromISO(date, { zone: 'utc' }).toFormat('yyyyMMdd');
}

export function buildIcs(calName: string, items: IcsItem[], dtstampIso: string): string {
  const stamp = utcStamp(dtstampIso);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lodestar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`,
  ];

  for (const it of items) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${it.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (it.allDay && it.startDate && it.endDate) {
      // DTEND is exclusive for all-day events → add one day to the inclusive end.
      const endExclusive = DateTime.fromISO(it.endDate, { zone: 'utc' })
        .plus({ days: 1 })
        .toFormat('yyyyMMdd');
      lines.push(`DTSTART;VALUE=DATE:${dateValue(it.startDate)}`);
      lines.push(`DTEND;VALUE=DATE:${endExclusive}`);
    } else if (!it.allDay && it.startUtc && it.endUtc) {
      lines.push(`DTSTART:${utcStamp(it.startUtc)}`);
      lines.push(`DTEND:${utcStamp(it.endUtc)}`);
    } else {
      // Incomplete item — skip the event body cleanly.
      lines.pop();
      lines.pop();
      lines.pop();
      continue;
    }
    lines.push(`SUMMARY:${escapeText(it.summary)}`);
    if (it.description) lines.push(`DESCRIPTION:${escapeText(it.description)}`);
    if (it.location) lines.push(`LOCATION:${escapeText(it.location)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
