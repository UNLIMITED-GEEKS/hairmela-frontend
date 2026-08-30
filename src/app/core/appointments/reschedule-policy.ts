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

/**
 * Whether this entry has a customer on the other end of a chat thread.
 *
 * A barber adding a walk-in or booking on someone's behalf creates an entry
 * with no account and no guest session attached — there is nobody to receive a
 * message, so the thread is shown to no one and the composer would be a box
 * that talks to itself.
 *
 * ⚠️ STAFF-AUTHENTICATED VIEWS ONLY. Both ids are documented as "null
 * publicly", so on a customer-facing surface every entry looks staff-added and
 * this would hide every thread. Call it from the barber's queue console and
 * the salon appointments list; never from the customer's live-queue or
 * my-position pages.
 *
 * Takes the shared shape rather than QueueEntry so the queue console's
 * TimelineEntryDto rows work too — both now carry these fields.
 */
export function hasChatCounterparty(entry: {
  userId?: string | null;
  guestId?: string | null;
}): boolean {
  return !!entry.userId || !!entry.guestId;
}
