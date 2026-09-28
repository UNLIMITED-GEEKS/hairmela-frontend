import { QueueEntry } from '../../api/models/queue-entry';

export const VISIT_HISTORY_TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;

export type VisitHistoryTab = (typeof VISIT_HISTORY_TABS)[number]['id'];

export function visitHistoryTabFor(entry: QueueEntry): VisitHistoryTab {
  switch (entry.status) {
    case 'WAITING':
      return 'upcoming';
    case 'SERVING':
      return 'in-progress';
    case 'SERVED':
      return 'completed';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'cancelled';
  }
}

export function filterVisitHistory(entries: QueueEntry[], tab: VisitHistoryTab): QueueEntry[] {
  return entries.filter((entry) => visitHistoryTabFor(entry) === tab);
}

export function countVisitHistory(entries: QueueEntry[]): Record<VisitHistoryTab, number> {
  const counts: Record<VisitHistoryTab, number> = {
    upcoming: 0,
    'in-progress': 0,
    completed: 0,
    cancelled: 0,
  };
  for (const entry of entries) {
    counts[visitHistoryTabFor(entry)] += 1;
  }
  return counts;
}
