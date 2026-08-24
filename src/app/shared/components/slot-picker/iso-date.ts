/**
 * Local-calendar ISO date helpers.
 *
 * Deliberately NOT `Date.prototype.toISOString().slice(0, 10)` — that converts
 * to UTC first, so any timezone behind UTC reports yesterday's date for the
 * late-evening hours. These formats read from the LOCAL calendar fields, which
 * is what a salon's booking day actually means.
 */
export function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** First and last calendar day of `month`, as ISO dates. */
export function monthRange(month: Date): { from: string; to: string } {
  return {
    from: toIsoDate(new Date(month.getFullYear(), month.getMonth(), 1)),
    to: toIsoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0)),
  };
}

/**
 * "14:00" -> "2pm", "10:30" -> "10:30am".
 *
 * Slots arrive as a bare 24-hour "HH:mm" with no date attached, so Angular's
 * `date` pipe can't format them without first fabricating a Date. On-the-hour
 * times drop the ":00" — a grid of "2pm, 3pm, 4pm" scans far faster than
 * "2:00 PM, 3:00 PM, 4:00 PM", which is what these buttons are for.
 *
 * Returns the input unchanged if it isn't parseable, so an unexpected format
 * shows something rather than nothing.
 */
export function formatSlotTime(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!match) return hhmm;

  const hours = Number(match[1]);
  const minutes = match[2];
  if (hours > 23 || Number(minutes) > 59) return hhmm;

  const suffix = hours < 12 ? 'am' : 'pm';
  // 0 -> 12am, 12 -> 12pm, 13 -> 1pm.
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === '00' ? `${hour12}${suffix}` : `${hour12}:${minutes}${suffix}`;
}
