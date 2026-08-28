/**
 * "Add to calendar" links for a confirmed appointment.
 *
 * No API, no OAuth, no keys: Google and Outlook.com take a pre-filled URL, and
 * everything else (Apple Calendar, Outlook desktop, Thunderbird) opens a
 * standard .ics file. That covers every platform without a Google Cloud
 * project or the OAuth verification review that writing to a calendar
 * directly would require.
 *
 * APPOINTMENTS ONLY. A walk-in has no scheduled time, so there is nothing to
 * put in a calendar — callers must not offer this for one.
 */

export interface CalendarEvent {
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
  readonly details?: string;
  readonly location?: string;
}

/** YYYYMMDDTHHMMSSZ — the format both Google and iCalendar expect, in UTC. */
function toStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarUrl(e: CalendarEvent): string {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', e.title);
  url.searchParams.set('dates', `${toStamp(e.start)}/${toStamp(e.end)}`);
  if (e.details) url.searchParams.set('details', e.details);
  if (e.location) url.searchParams.set('location', e.location);
  return url.toString();
}

export function outlookCalendarUrl(e: CalendarEvent): string {
  const url = new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  url.searchParams.set('path', '/calendar/action/compose');
  url.searchParams.set('rru', 'addevent');
  url.searchParams.set('subject', e.title);
  // Outlook wants ISO-8601 with offsets, not the compact stamp above.
  url.searchParams.set('startdt', e.start.toISOString());
  url.searchParams.set('enddt', e.end.toISOString());
  if (e.details) url.searchParams.set('body', e.details);
  if (e.location) url.searchParams.set('location', e.location);
  return url.toString();
}

/**
 * An .ics document — what Apple Calendar and Outlook desktop understand.
 *
 * Lines are CRLF-terminated and text is escaped per RFC 5545; a raw comma or
 * newline in a salon name would otherwise truncate the field and produce a
 * file the calendar silently refuses to import.
 */
export function icsContent(e: CalendarEvent, uid: string): string {
  const esc = (v: string) =>
    v.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HairMela//Appointment//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@hairmela.com`,
    `DTSTAMP:${toStamp(new Date())}`,
    `DTSTART:${toStamp(e.start)}`,
    `DTEND:${toStamp(e.end)}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.details ? [`DESCRIPTION:${esc(e.details)}`] : []),
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    // A reminder an hour ahead — the reason most people add this to a calendar
    // at all.
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Appointment reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}
