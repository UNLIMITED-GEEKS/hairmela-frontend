import { BroadcastRunStatus, BroadcastSchedule } from './broadcast-automation.types';

// Index 1–7 (Mon–Sun) to match the API's weekday numbering; index 0 unused.
export const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// "HH:mm" → "9:00 AM". Same 12-hour display as the time picker the owner
// entered it with.
export function formatLocalTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${period}`;
}

// "yyyy-MM-dd" → "3 Nov 2026". Parsed by hand: new Date('yyyy-MM-dd') is UTC
// midnight and would render as the previous day west of UTC.
export function formatLocalDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export function describeSchedule(schedule: BroadcastSchedule): string {
  const at = formatLocalTime(schedule.time);
  switch (schedule.kind) {
    case 'ONCE':
      return `Once on ${formatLocalDate(schedule.date)} at ${at}`;
    case 'DAILY':
      return `Every day at ${at}`;
    case 'WEEKLY': {
      const days = [...schedule.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]);
      const list =
        days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}` : days[0];
      return `Every ${list} at ${at}`;
    }
    case 'MONTHLY': {
      const suffix = schedule.dayOfMonth >= 29 ? ' (last day in shorter months)' : '';
      return `On the ${ordinal(schedule.dayOfMonth)} of each month at ${at}${suffix}`;
    }
    case 'EVERY_N_DAYS':
      return `Every ${schedule.intervalDays} days from ${formatLocalDate(schedule.startDate)} at ${at}`;
  }
}

export const RUN_STATUS_LABEL: Record<BroadcastRunStatus, string> = {
  SENT: 'Sent',
  SKIPPED_DAILY_LIMIT: 'Skipped — another automated message already went out that day',
  SKIPPED_SALON_FROZEN: 'Skipped — upgrade your plan to send messages',
  FAILED: "Didn't send — it will try again at the next scheduled time",
};

// nextRunAt/lastRunAt are UTC ISO. Shown in the owner's own timezone, with the
// salon's local time alongside only when the two differ.
export function formatRunTime(iso: string, salonTimezone: string): string {
  const date = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  };
  const mine = date.toLocaleString('en-GB', opts);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (browserTz === salonTimezone) return mine;
  const salon = date.toLocaleString('en-GB', { ...opts, timeZone: salonTimezone });
  return `${mine} (salon time: ${salon})`;
}

// "Africa/Lagos" → "Lagos time", for labelling salon-local fields.
export function timezoneLabel(timezone: string): string {
  return `${timezone.split('/').pop()!.replace(/_/g, ' ')} time`;
}

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Whether `schedule` sends on `day` (a local-midnight Date standing for a
// salon calendar day). Weekdays use the API's ISO numbering, 1=Mon … 7=Sun —
// not getDay(), where Sunday is 0.
export function scheduleOccursOn(schedule: BroadcastSchedule, day: Date): boolean {
  switch (schedule.kind) {
    case 'ONCE':
      return parseLocalDate(schedule.date).getTime() === day.getTime();
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return schedule.weekdays.includes(day.getDay() === 0 ? 7 : day.getDay());
    case 'MONTHLY': {
      const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
      return day.getDate() === Math.min(schedule.dayOfMonth, lastDay);
    }
    case 'EVERY_N_DAYS': {
      const diff = Math.round((day.getTime() - parseLocalDate(schedule.startDate).getTime()) / 86_400_000);
      return diff >= 0 && diff % schedule.intervalDays === 0;
    }
  }
}

// Only one automated message goes out per salon per day, so two schedules that
// share a day mean the later one gets skipped. Checked over the next 90 days —
// the longest repeat interval the API allows.
export function schedulesOverlap(a: BroadcastSchedule, b: BroadcastSchedule): boolean {
  const today = new Date();
  for (let offset = 0; offset < 90; offset++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    if (scheduleOccursOn(a, day) && scheduleOccursOn(b, day)) return true;
  }
  return false;
}
