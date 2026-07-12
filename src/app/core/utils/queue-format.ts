// Shared formatting helpers for queue position/wait display — used wherever
// a position number or an estimated-wait duration is shown to the customer
// (join banner, position page, live-queue page, queue console).

/** "1st" / "2nd" / "3rd" / "4th" — English ordinal suffix for a position number. */
export function ordinalSuffix(n: number): string {
  const remainder100 = n % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/** Formats a wait duration in minutes as "< 1m", "45m", or "1h 5m". */
export function formatWait(minutes: number): string {
  if (minutes < 1) return '< 1m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
