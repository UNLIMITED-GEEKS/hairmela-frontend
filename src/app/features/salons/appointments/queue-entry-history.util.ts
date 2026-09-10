import { QueueEntry } from '../../../api/models/queue-entry';
import { hasChatCounterparty } from '../../../core/appointments/reschedule-policy';

/** Calendar day represented by an entry in the history response. */
export function queueEntryHistoryDate(entry: QueueEntry): string | null {
  const timestamp = entry.type === 'APPOINTMENT' ? entry.scheduledAt : entry.createdAt;
  return timestamp ? timestamp.slice(0, 10) : null;
}

/** Chat is available for today's entries and future appointments only. */
export function canChatFromHistory(entry: QueueEntry, today: string): boolean {
  if (!hasChatCounterparty(entry)) return false;

  const entryDate = queueEntryHistoryDate(entry);
  if (!entryDate) return false;

  if (entry.type === 'WALK_IN') return entryDate === today;
  return entryDate >= today;
}
