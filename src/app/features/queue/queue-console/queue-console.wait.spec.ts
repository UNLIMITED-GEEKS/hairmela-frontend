import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { QueueConsoleService } from './queue-console.service';
import { TimelineEntryDto } from '../../../core/socket/socket.types';
import { TimelineMemberDto } from '../../../api/models/timeline-member-dto';

// Covers the optimistic temp-entry wait baseline — the number painted for a
// newly-added client BEFORE the server's own timeline lands. It must match the
// backend's remainingDurationOf (timeline.service.ts), because the server's
// value replaces it moments later and any divergence shows as a visible jump.
//
// The original bug: the baseline was Math.max over every entry's
// estimatedWaitMinutes, but a SERVING entry always reports 0 for itself — so a
// queue with someone being served and nobody waiting yet painted "0 wait",
// ignoring the barber's remaining time entirely.

function member(over: Partial<TimelineMemberDto> = {}): TimelineMemberDto {
  return {
    isLeader: true,
    memberId: 'm1',
    memberName: 'Client',
    phone: null,
    servedAt: null,
    serviceDuration: 30,
    serviceId: 's1',
    serviceName: 'Cut',
    status: 'WAITING',
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function entry(over: Partial<TimelineEntryDto> = {}): TimelineEntryDto {
  return {
    entryId: 'e1',
    estimatedWaitMinutes: 0,
    isUpcoming: false,
    members: [member()],
    position: 1,
    scheduledAt: null,
    type: 'WALK_IN',
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe('QueueConsoleService — optimistic wait baseline', () => {
  let svc: QueueConsoleService;
  // Reaches the private members under test. They're private by design (internal
  // paint math, not API), but they're exactly the logic worth pinning down.
  let asAny: {
    _optimisticBaselineWaitMinutes(): number;
    _entryRemainingMinutes(e: TimelineEntryDto, nowMs: number): number;
    _serverTimeline: { set(v: TimelineEntryDto[]): void };
  };

  const seedTimeline = (entries: TimelineEntryDto[]): void =>
    asAny._serverTimeline.set(entries);

  beforeEach(() => {
    TestBed.configureTestingModule({
      // QueueConsoleService is a plain @Injectable() (provided per-route, not
      // in root), so it has to be supplied explicitly here.
      providers: [QueueConsoleService, provideHttpClient(), provideRouter([])],
    });
    svc = TestBed.inject(QueueConsoleService);
    asAny = svc as unknown as typeof asAny;
  });

  describe('_entryRemainingMinutes', () => {
    it('returns full party duration when nothing has started yet', () => {
      const e = entry({ members: [member({ serviceDuration: 30 }), member({ memberId: 'm2', serviceDuration: 20 })] });
      expect(asAny._entryRemainingMinutes(e, Date.now())).toBe(50);
    });

    it('subtracts elapsed since the party entered the chair', () => {
      const now = Date.now();
      const e = entry({
        members: [member({ status: 'SERVING', servedAt: new Date(now - 5 * 60_000).toISOString(), serviceDuration: 30 })],
      });
      expect(asAny._entryRemainingMinutes(e, now)).toBeCloseTo(25, 5);
    });

    // The defect this suite exists for: a party occupies the chair until its
    // LAST member is done, so the whole party's duration counts — not just the
    // member currently being served.
    it('counts the whole party, not only the member in the chair', () => {
      const now = Date.now();
      const e = entry({
        members: [
          member({ memberId: 'm1', status: 'SERVING', servedAt: new Date(now - 5 * 60_000).toISOString(), serviceDuration: 30 }),
          member({ memberId: 'm2', status: 'WAITING', serviceDuration: 30 }),
          member({ memberId: 'm3', status: 'WAITING', serviceDuration: 30 }),
        ],
      });
      // 90 total − 5 elapsed = 85, NOT 30 − 5 = 25.
      expect(asAny._entryRemainingMinutes(e, now)).toBeCloseTo(85, 5);
    });

    it('uses the earliest servedAt across members, not the latest', () => {
      const now = Date.now();
      const e = entry({
        members: [
          member({ memberId: 'm1', status: 'SERVED', servedAt: new Date(now - 20 * 60_000).toISOString(), serviceDuration: 30 }),
          member({ memberId: 'm2', status: 'SERVING', servedAt: new Date(now - 2 * 60_000).toISOString(), serviceDuration: 30 }),
        ],
      });
      // Party entered the chair 20m ago: 60 total − 20 = 40.
      expect(asAny._entryRemainingMinutes(e, now)).toBeCloseTo(40, 5);
    });

    it('floors at 0 for an over-running service', () => {
      const now = Date.now();
      const e = entry({
        members: [member({ status: 'SERVING', servedAt: new Date(now - 90 * 60_000).toISOString(), serviceDuration: 30 })],
      });
      expect(asAny._entryRemainingMinutes(e, now)).toBe(0);
    });

    it('treats a SERVING entry with no servedAt as just started', () => {
      const e = entry({ members: [member({ status: 'SERVING', servedAt: null, serviceDuration: 30 })] });
      expect(asAny._entryRemainingMinutes(e, Date.now())).toBe(30);
    });
  });

  describe('_optimisticBaselineWaitMinutes', () => {
    it('is 0 for a completely empty queue', () => {
      seedTimeline([]);
      expect(asAny._optimisticBaselineWaitMinutes()).toBe(0);
    });

    // The original bug, pinned: serving client, nobody waiting yet.
    it('uses the serving entry remaining time when nothing is waiting', () => {
      const now = Date.now();
      seedTimeline([
        entry({
          position: 0,
          estimatedWaitMinutes: 0,
          members: [member({ status: 'SERVING', servedAt: new Date(now - 10 * 60_000).toISOString(), serviceDuration: 30 })],
        }),
      ]);
      // Must be ~20, never 0.
      expect(asAny._optimisticBaselineWaitMinutes()).toBeCloseTo(20, 0);
    });

    // Guards the baseline against regressing to a per-SERVING-member sum: a
    // party occupies the chair until its LAST member is done, so a new arrival
    // waits for all of it, not just the one member currently being served.
    it('counts the whole serving party when nothing else is waiting', () => {
      const now = Date.now();
      seedTimeline([
        entry({
          position: 0,
          estimatedWaitMinutes: 0,
          members: [
            member({ memberId: 'm1', status: 'SERVING', servedAt: new Date(now - 5 * 60_000).toISOString(), serviceDuration: 30 }),
            member({ memberId: 'm2', status: 'WAITING', serviceDuration: 30 }),
            member({ memberId: 'm3', status: 'WAITING', serviceDuration: 30 }),
          ],
        }),
      ]);
      // 90 total − 5 elapsed = 85. A per-serving-member sum would give 25.
      expect(asAny._optimisticBaselineWaitMinutes()).toBeCloseTo(85, 0);
    });

    it('prefers the max waiting estimate once a real waiting entry exists', () => {
      seedTimeline([
        entry({ entryId: 'serving', position: 0, members: [member({ status: 'SERVING', servedAt: new Date().toISOString() })] }),
        entry({ entryId: 'w1', position: 1, estimatedWaitMinutes: 25, members: [member({ memberId: 'w1m' })] }),
        entry({ entryId: 'w2', position: 2, estimatedWaitMinutes: 55, members: [member({ memberId: 'w2m' })] }),
      ]);
      expect(asAny._optimisticBaselineWaitMinutes()).toBe(55);
    });
  });
});
