import { AbstractControl, ValidationErrors } from '@angular/forms';

/** "HH:mm" -> minutes since midnight. NaN for anything unparseable. */
export function timeToMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Cross-field validator for a group holding startTime/endTime as "HH:mm".
// Applied to the GROUP (not either control) because the rule is a
// relationship between the two, not a property of either one alone.
//
// NOTE: frontend-only. The backend does not currently reject
// endTime <= startTime on operating hours or staff schedules, so this is a
// UX affordance, not an enforcement boundary — a direct API call can still
// store an inverted range.
export function endAfterStart(group: AbstractControl): ValidationErrors | null {
  const start = timeToMinutes(group.get('startTime')?.value);
  const end = timeToMinutes(group.get('endTime')?.value);
  // Don't invent an error for a half-filled/unparseable group — `required`
  // and the control's own validators own that case.
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return end > start ? null : { endBeforeStart: true };
}
