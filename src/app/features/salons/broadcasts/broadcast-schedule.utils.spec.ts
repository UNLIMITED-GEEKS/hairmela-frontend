import { describe, expect, it } from 'vitest';
import { describeSchedule, formatLocalTime, schedulesOverlap } from './broadcast-schedule.utils';

describe('describeSchedule', () => {
  it('describes weekly schedules with joined weekday names', () => {
    expect(describeSchedule({ kind: 'WEEKLY', time: '09:00', weekdays: [1] })).toBe('Every Monday at 9:00 AM');
    expect(describeSchedule({ kind: 'WEEKLY', time: '18:30', weekdays: [5, 1, 3] })).toBe(
      'Every Monday, Wednesday and Friday at 6:30 PM',
    );
  });

  it('notes the short-month fallback for days 29–31 only', () => {
    expect(describeSchedule({ kind: 'MONTHLY', time: '09:00', dayOfMonth: 31 })).toBe(
      'On the 31st of each month at 9:00 AM (last day in shorter months)',
    );
    expect(describeSchedule({ kind: 'MONTHLY', time: '09:00', dayOfMonth: 2 })).toBe('On the 2nd of each month at 9:00 AM');
    expect(describeSchedule({ kind: 'MONTHLY', time: '09:00', dayOfMonth: 11 })).toContain('11th');
  });

  it('describes every-N-days and once schedules', () => {
    expect(
      describeSchedule({ kind: 'EVERY_N_DAYS', time: '18:00', intervalDays: 3, startDate: '2026-11-03' }),
    ).toBe('Every 3 days from 3 Nov 2026 at 6:00 PM');
    expect(describeSchedule({ kind: 'ONCE', time: '09:00', date: '2026-11-03' })).toBe('Once on 3 Nov 2026 at 9:00 AM');
  });

  it('formats midnight and noon as 12-hour', () => {
    expect(formatLocalTime('00:05')).toBe('12:05 AM');
    expect(formatLocalTime('12:00')).toBe('12:00 PM');
  });
});

describe('schedulesOverlap', () => {
  it('flags schedules that share a day within 90 days', () => {
    expect(
      schedulesOverlap({ kind: 'DAILY', time: '09:00' }, { kind: 'WEEKLY', time: '18:00', weekdays: [1, 2, 3, 4, 5, 6, 7] }),
    ).toBe(true);
    expect(
      schedulesOverlap({ kind: 'WEEKLY', time: '09:00', weekdays: [1, 2, 3] }, { kind: 'WEEKLY', time: '09:00', weekdays: [3, 5] }),
    ).toBe(true);
  });

  it('does not flag schedules on different days', () => {
    expect(
      schedulesOverlap({ kind: 'WEEKLY', time: '09:00', weekdays: [1] }, { kind: 'WEEKLY', time: '09:00', weekdays: [2, 3] }),
    ).toBe(false);
  });
});
