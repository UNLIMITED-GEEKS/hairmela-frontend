import { QueueEntry } from '../../api/models/queue-entry';

/**
 * Fallback when a salon hasn't set its own cancellationWindow.
 *
 * Salon.settings is an untyped blob on the wire (the backend doesn't declare
 * its shape in Swagger), hence the bracket-index-and-cast below — the same
 * pattern used by salon-settings.component.ts and salon-visit.service.ts.
 */
const DEFAULT_CANCELLATION_WINDOW_MINUTES = 60;

export function cancellationWindowMinutes(entry: QueueEntry): number {
  const settings = entry.queue?.salon?.settings as Record<string, unknown> | undefined;
  return (settings?.['cancellationWindow'] as number) ?? DEFAULT_CANCELLATION_WINDOW_MINUTES;
}

/** Far enough out that the salon still allows changes. */
export function withinChangeWindow(entry: QueueEntry): boolean {
  if (!entry.scheduledAt) return false;
  const windowMs = cancellationWindowMinutes(entry) * 60 * 1000;
  return new Date(entry.scheduledAt).getTime() - Date.now() >= windowMs;
}

/**
 * Whether this entry may be rescheduled — the single source of truth for the
 * button's visibility on every surface that offers it (queue list, my
 * position, my history, the staff/admin appointments list).
 *
 * Three rules, all owned by the backend; this mirrors them so the button is
 * simply absent rather than failing on click:
 *   1. Appointments only — walk-in queue entries have no slot to move.
 *   2. Once per booking — a second attempt returns ALREADY_RESCHEDULED.
 *      rescheduledAt is the backend's own record of that.
 *   3. The salon's cancellation window must not have passed.
 *
 * The server still enforces all three: two people can act on one appointment
 * at once, so callers must handle the error codes as well as this check.
 */
export function canReschedule(entry: QueueEntry): boolean {
  if (entry.type !== 'APPOINTMENT') return false;
  if (entry.rescheduledAt) return false;
  return withinChangeWindow(entry);
}
