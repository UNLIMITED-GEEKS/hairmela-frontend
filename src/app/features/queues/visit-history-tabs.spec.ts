import { QueueEntry } from '../../api/models/queue-entry';
import { countVisitHistory, filterVisitHistory, visitHistoryTabFor } from './visit-history-tabs';

const entry = (status: QueueEntry['status']) => ({ status }) as QueueEntry;

describe('visit history tabs', () => {
  it.each([
    ['WAITING', 'upcoming'],
    ['SERVING', 'in-progress'],
    ['SERVED', 'completed'],
    ['CANCELLED', 'cancelled'],
    ['NO_SHOW', 'cancelled'],
  ] as const)('maps %s to %s', (status, tab) => {
    expect(visitHistoryTabFor(entry(status))).toBe(tab);
  });

  it('filters the already-loaded entries without another data source', () => {
    const entries = [entry('WAITING'), entry('SERVED'), entry('CANCELLED')];

    expect(filterVisitHistory(entries, 'completed')).toEqual([entries[1]]);
  });

  it('counts all four categories and includes no-shows under cancelled', () => {
    expect(
      countVisitHistory([
        entry('WAITING'),
        entry('SERVING'),
        entry('SERVED'),
        entry('CANCELLED'),
        entry('NO_SHOW'),
      ]),
    ).toEqual({ upcoming: 1, 'in-progress': 1, completed: 1, cancelled: 2 });
  });
});
