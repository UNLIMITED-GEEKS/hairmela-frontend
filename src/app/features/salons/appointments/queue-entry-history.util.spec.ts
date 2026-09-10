import { QueueEntry } from '../../../api/models/queue-entry';
import { canChatFromHistory, queueEntryHistoryDate } from './queue-entry-history.util';

function entry(overrides: Partial<QueueEntry>): QueueEntry {
  return {
    type: 'APPOINTMENT',
    scheduledAt: '2026-09-10T12:00:00.000Z',
    createdAt: '2026-09-01T12:00:00.000Z',
    userId: 'user-1',
    guestId: null,
    ...overrides,
  } as QueueEntry;
}

describe('queue entry history rules', () => {
  it('uses scheduledAt for appointments and createdAt for walk-ins', () => {
    expect(queueEntryHistoryDate(entry({}))).toBe('2026-09-10');
    expect(
      queueEntryHistoryDate(
        entry({ type: 'WALK_IN', scheduledAt: null, createdAt: '2026-09-09T08:00:00.000Z' }),
      ),
    ).toBe('2026-09-09');
  });

  it('shows appointment chat today and in the future, but not in the past', () => {
    expect(
      canChatFromHistory(entry({ scheduledAt: '2026-09-10T08:00:00.000Z' }), '2026-09-10'),
    ).toBe(true);
    expect(
      canChatFromHistory(entry({ scheduledAt: '2026-09-11T08:00:00.000Z' }), '2026-09-10'),
    ).toBe(true);
    expect(
      canChatFromHistory(entry({ scheduledAt: '2026-09-09T08:00:00.000Z' }), '2026-09-10'),
    ).toBe(false);
  });

  it('shows walk-in chat only today and guards against future walk-ins', () => {
    expect(
      canChatFromHistory(
        entry({ type: 'WALK_IN', createdAt: '2026-09-10T08:00:00.000Z' }),
        '2026-09-10',
      ),
    ).toBe(true);
    expect(
      canChatFromHistory(
        entry({ type: 'WALK_IN', createdAt: '2026-09-09T08:00:00.000Z' }),
        '2026-09-10',
      ),
    ).toBe(false);
    expect(
      canChatFromHistory(
        entry({ type: 'WALK_IN', createdAt: '2026-09-11T08:00:00.000Z' }),
        '2026-09-10',
      ),
    ).toBe(false);
  });

  it('hides chat when the entry has no customer or guest counterparty', () => {
    expect(canChatFromHistory(entry({ userId: null, guestId: null }), '2026-09-10')).toBe(false);
  });
});
