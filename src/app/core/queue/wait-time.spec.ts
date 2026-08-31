import { TimelineEntryDto } from '../socket/socket.types';
import { TimelineMemberDto } from '../../api/models/timeline-member-dto';
import {
  WaitContext,
  isProjectionStale,
  computeLiveWaitMinutes,
  computeMemberWaitMinutes,
  effectiveSinceSnapshotMs,
  entryRemainingMinutes,
  formatWait,
  servingBookedMinutesFor,
  servingElapsedMsFor,
} from './wait-time';

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
    guestId: null,
    userId: null,
    isUpcoming: false,
    members: [member()],
    position: 1,
    scheduledAt: null,
    type: 'WALK_IN',
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function ctx(over: Partial<WaitContext> = {}): WaitContext {
  return {
    timeline: [],
    sinceSnapshotMs: 0,
    servingElapsedMs: null,
    servingBookedMinutes: null,
    ...over,
  };
}

describe('wait-time', () => {
  describe('computeLiveWaitMinutes', () => {
    it('reproduces the backend numbers exactly at the moment a fresh frame lands (sinceSnapshotMs = 0)', () => {
      const c = ctx({
        timeline: [
          entry({ entryId: 'serving', estimatedWaitMinutes: 0 }),
          entry({ entryId: 'w1', estimatedWaitMinutes: 30 }),
          entry({ entryId: 'w2', estimatedWaitMinutes: 60 }),
        ],
      });
      const waits = computeLiveWaitMinutes(c);
      expect(waits.get('serving')).toBe(0);
      expect(waits.get('w1')).toBe(30);
      expect(waits.get('w2')).toBe(60);
    });

    it('ticks down in real time as time passes since the snapshot', () => {
      const c = ctx({
        timeline: [entry({ entryId: 'w1', estimatedWaitMinutes: 30 })],
        sinceSnapshotMs: 10 * 60_000,
      });
      expect(computeLiveWaitMinutes(c).get('w1')).toBe(20);
    });

    it('floors at 0 rather than going negative once sinceSnapshotMs exceeds the estimate', () => {
      const c = ctx({
        timeline: [entry({ entryId: 'w1', estimatedWaitMinutes: 10 })],
        sinceSnapshotMs: 25 * 60_000,
      });
      expect(computeLiveWaitMinutes(c).get('w1')).toBe(0);
    });

    // THE SCREENSHOT SCENARIO: a barber overruns a serving client's booked
    // duration with no new socket frame. Entries further back in line must
    // NOT collapse toward 0 in lockstep — only genuinely-next-in-line should
    // approach it. This is the case that FAILED against today's formula
    // (queue-console.live-wait.spec.ts pins that down against the real,
    // unfixed service) and must PASS here once the caller freezes
    // sinceSnapshotMs at the moment staleness began (see the freeze-latch
    // design in each service — this function itself just trusts whatever
    // sinceSnapshotMs it's given).
    it('holds differentiated waits for entries behind an overrunning serving client once frozen', () => {
      // The caller detected staleness and froze sinceSnapshotMs at 0 (i.e.
      // stopped advancing it) rather than letting it keep growing with the
      // overrun — this is what "freeze" means mechanically for this function.
      const frozenSinceSnapshotMs = 0;
      const c = ctx({
        timeline: [
          entry({ entryId: 'serving', estimatedWaitMinutes: 0 }),
          entry({ entryId: 'w1', estimatedWaitMinutes: 30 }),
          entry({ entryId: 'w2', estimatedWaitMinutes: 60 }),
          entry({ entryId: 'w3', estimatedWaitMinutes: 90 }),
        ],
        sinceSnapshotMs: frozenSinceSnapshotMs,
      });
      const waits = computeLiveWaitMinutes(c);
      expect(waits.get('w1')).toBe(30);
      expect(waits.get('w2')).toBe(60);
      expect(waits.get('w3')).toBe(90);
      expect(waits.get('w3')!).toBeGreaterThan(waits.get('w2')!);
      expect(waits.get('w2')!).toBeGreaterThan(waits.get('w1')!);
    });
  });

  describe('isProjectionStale', () => {
    it('is false when nobody is serving', () => {
      expect(isProjectionStale(ctx())).toBe(false);
    });

    it('is false while the serving member is still within their booked duration', () => {
      const c = ctx({ servingElapsedMs: 20 * 60_000, servingBookedMinutes: 30 });
      expect(isProjectionStale(c)).toBe(false);
    });

    it('is true once elapsed exceeds the booked duration (the overrun case)', () => {
      const c = ctx({ servingElapsedMs: 91 * 60_000, servingBookedMinutes: 30 });
      expect(isProjectionStale(c)).toBe(true);
    });

    it('is false exactly at the boundary (elapsed == booked)', () => {
      const c = ctx({ servingElapsedMs: 30 * 60_000, servingBookedMinutes: 30 });
      expect(isProjectionStale(c)).toBe(false);
    });
  });

  // The freeze itself — previously untested, because the pure compute
  // functions take an already-frozen sinceSnapshotMs as an input. This is the
  // logic that decides that value.
  describe('effectiveSinceSnapshotMs', () => {
    const BOOKED = 30;

    it('is 0 before any frame has landed', () => {
      expect(
        effectiveSinceSnapshotMs({
          nowMs: 1_000_000,
          snapshotAtMs: null,
          servingElapsedMs: null,
          servingBookedMinutes: null,
        }),
      ).toBe(0);
    });

    it('grows in real time while the serving party is within its booking', () => {
      const servedAt = 0;
      const now = 10 * 60_000;
      expect(
        effectiveSinceSnapshotMs({
          nowMs: now,
          snapshotAtMs: servedAt,
          servingElapsedMs: now - servedAt,
          servingBookedMinutes: BOOKED,
        }),
      ).toBe(10 * 60_000);
    });

    // THE REPORTED BUG: with nobody in the chair, estimatedWaitMinutes from
    // the backend is a static sum of durations — no servedAt exists to
    // project elapsed time against, so there is no honest decay to apply.
    // Ticking it down anyway meant an entirely idle queue's wait numbers
    // silently drained toward 0 in real time even though nothing was
    // happening. Must freeze at 0, not grow, and must stay at 0 no matter
    // how long the queue sits idle (checked across a wide span, same
    // discipline as the overrun-freeze test below).
    it('freezes at 0 when nobody is serving — never decays an idle queue\'s wait numbers', () => {
      const ages = [1, 10, 42, 600].map((mins) =>
        effectiveSinceSnapshotMs({
          nowMs: mins * 60_000,
          snapshotAtMs: 0,
          servingElapsedMs: null,
          servingBookedMinutes: null,
        }),
      );
      expect(ages).toEqual([0, 0, 0, 0]);
    });

    // The instant someone IS called, the countdown must resume from a fresh
    // snapshot rather than staying stuck at the old freeze.
    it('resumes ticking once a fresh frame reports someone actually serving', () => {
      const servedAt = 5 * 60_000;
      const now = 8 * 60_000;
      expect(
        effectiveSinceSnapshotMs({
          nowMs: now,
          snapshotAtMs: servedAt, // the frame that reported the call landed here
          servingElapsedMs: now - servedAt,
          servingBookedMinutes: BOOKED,
        }),
      ).toBe(3 * 60_000);
    });

    // THE FREEZE: past the booking, the returned age stops growing. Checked
    // across a wide span so a slow drift would show up, not just one instant.
    it('stops growing once the serving party overruns, no matter how long the overrun runs', () => {
      const servedAt = 0;
      const snapshotAt = 0;
      const ages = [31, 45, 60, 120, 600].map((mins) =>
        effectiveSinceSnapshotMs({
          nowMs: mins * 60_000,
          snapshotAtMs: snapshotAt,
          servingElapsedMs: mins * 60_000 - servedAt,
          servingBookedMinutes: BOOKED,
        }),
      );
      // Every one is pinned to the instant the booking ran out (30m in).
      expect(ages).toEqual([
        BOOKED * 60_000,
        BOOKED * 60_000,
        BOOKED * 60_000,
        BOOKED * 60_000,
        BOOKED * 60_000,
      ]);
    });

    // A frame that lands mid-service anchors later than servedAt, so the
    // frozen age is correspondingly smaller — it measures snapshot→overrun,
    // not serve→overrun.
    it('freezes at the overrun instant measured from the snapshot, not from servedAt', () => {
      const servedAt = 0;
      const snapshotAt = 25 * 60_000; // frame landed 25m into the service
      const now = 90 * 60_000; // long overrun
      expect(
        effectiveSinceSnapshotMs({
          nowMs: now,
          snapshotAtMs: snapshotAt,
          servingElapsedMs: now - servedAt,
          servingBookedMinutes: BOOKED,
        }),
      ).toBe(5 * 60_000); // 30m booking ran out 5m after the frame landed
    });

    it('never returns a negative age when a frame lands after the overrun began', () => {
      const servedAt = 0;
      const snapshotAt = 50 * 60_000; // frame landed 20m INTO the overrun
      const now = 60 * 60_000;
      expect(
        effectiveSinceSnapshotMs({
          nowMs: now,
          snapshotAtMs: snapshotAt,
          servingElapsedMs: now - servedAt,
          servingBookedMinutes: BOOKED,
        }),
      ).toBe(0);
    });

    // End-to-end on the reported bug: the back of the line must keep a real,
    // differentiated wait instead of collapsing to "< 1m" with everyone else.
    it('keeps waits differentiated behind an overrunning client (the reported bug)', () => {
      const timeline = [
        entry({
          entryId: 'serving',
          estimatedWaitMinutes: 0,
          members: [member({ memberId: 'sm', status: 'SERVING', serviceDuration: BOOKED })],
        }),
        entry({ entryId: 'w1', estimatedWaitMinutes: 30, members: [member({ memberId: 'w1m' })] }),
        entry({ entryId: 'w2', estimatedWaitMinutes: 60, members: [member({ memberId: 'w2m' })] }),
        entry({ entryId: 'w3', estimatedWaitMinutes: 90, members: [member({ memberId: 'w3m' })] }),
      ];
      const at = (mins: number): Map<string, number> => {
        const nowMs = mins * 60_000;
        const servingElapsedMs = nowMs;
        const sinceSnapshotMs = effectiveSinceSnapshotMs({
          nowMs,
          snapshotAtMs: 0,
          servingElapsedMs,
          servingBookedMinutes: BOOKED,
        });
        return computeLiveWaitMinutes({
          timeline,
          sinceSnapshotMs,
          servingElapsedMs,
          servingBookedMinutes: BOOKED,
        });
      };

      // Two hours into a 30-minute booking, with no new frame.
      const late = at(120);
      expect(late.get('w1')).toBe(0); // next in line — legitimately "< 1m"
      expect(late.get('w2')).toBe(30); // still a real wait
      expect(late.get('w3')).toBe(60); // and still ordered behind w2
      expect(late.get('w3')!).toBeGreaterThan(late.get('w2')!);

      // Identical to the moment the overrun began — proof it froze.
      expect([...at(31).values()]).toEqual([...late.values()]);
    });
  });

  describe('servingElapsedMsFor', () => {
    it('returns null when nobody has a servedAt yet', () => {
      const e = entry({ members: [member({ status: 'SERVING', servedAt: null })] });
      expect(servingElapsedMsFor(e, Date.now())).toBeNull();
    });

    it('uses the single member\'s servedAt for a 1-member entry', () => {
      const now = Date.now();
      const e = entry({ members: [member({ status: 'SERVING', servedAt: new Date(now - 5 * 60_000).toISOString() })] });
      expect(servingElapsedMsFor(e, now)).toBeCloseTo(5 * 60_000, -2);
    });

    // Per-member accounting: each member's remaining time runs on their OWN
    // clock, because the backend stamps a fresh servedAt as each takes the
    // chair. So an already-SERVED member's earlier timestamp is irrelevant —
    // what matters is when the current occupant sat down.
    //
    // This deliberately inverts an earlier rule (party's earliest servedAt),
    // which changed together with the backend's remainingDurationOf: the old
    // party-total behaviour zeroed out untouched members once one member
    // overran the party's combined booking.
    it('uses the IN-CHAIR member\'s own servedAt, not the party\'s earliest', () => {
      const now = Date.now();
      const e = entry({
        members: [
          member({ memberId: 'm1', status: 'SERVED', servedAt: new Date(now - 20 * 60_000).toISOString() }),
          member({ memberId: 'm2', status: 'SERVING', servedAt: new Date(now - 2 * 60_000).toISOString() }),
        ],
      });
      // The current occupant took the chair 2m ago; m1's 20m is spent history.
      expect(servingElapsedMsFor(e, now)).toBeCloseTo(2 * 60_000, -2);
    });

    it('returns null when no member is in the chair', () => {
      const e = entry({
        members: [member({ memberId: 'm1', status: 'SERVED', servedAt: new Date().toISOString() })],
      });
      expect(servingElapsedMsFor(e, Date.now())).toBeNull();
    });
  });

  describe('servingBookedMinutesFor', () => {
    it('is the in-chair member\'s own booking, not the party total', () => {
      const e = entry({
        members: [
          member({ memberId: 'm1', status: 'SERVING', serviceDuration: 30 }),
          member({ memberId: 'm2', status: 'WAITING', serviceDuration: 45 }),
        ],
      });
      expect(servingBookedMinutesFor(e)).toBe(30);
    });

    it('is null when nobody is in the chair', () => {
      expect(servingBookedMinutesFor(entry())).toBeNull();
    });
  });

  // Mirrors the backend's remainingDurationOf — these must not drift.
  describe('entryRemainingMinutes', () => {
    it('sums full durations when nothing has started', () => {
      const e = entry({
        members: [
          member({ memberId: 'm1', serviceDuration: 30 }),
          member({ memberId: 'm2', serviceDuration: 20 }),
        ],
      });
      expect(entryRemainingMinutes(e, Date.now())).toBe(50);
    });

    // THE REPORTED BUG: party of 3 x 30m, first member 120m into their own
    // 30m cut, other two untouched. Party-total math gave max(0, 90-120) = 0,
    // telling the next client "< 1m". Per-member gives 0 + 30 + 30 = 60.
    it('keeps untouched members\' time when the in-chair member overruns', () => {
      const now = Date.now();
      const e = entry({
        members: [
          member({ memberId: 'm1', status: 'SERVING', serviceDuration: 30, servedAt: new Date(now - 120 * 60_000).toISOString() }),
          member({ memberId: 'm2', status: 'WAITING', serviceDuration: 30 }),
          member({ memberId: 'm3', status: 'WAITING', serviceDuration: 30 }),
        ],
      });
      expect(entryRemainingMinutes(e, now)).toBe(60);
    });

    it('subtracts elapsed from the in-chair member only', () => {
      const now = Date.now();
      const e = entry({
        members: [
          member({ memberId: 'm1', status: 'SERVING', serviceDuration: 30, servedAt: new Date(now - 10 * 60_000).toISOString() }),
          member({ memberId: 'm2', status: 'WAITING', serviceDuration: 30 }),
        ],
      });
      expect(entryRemainingMinutes(e, now)).toBeCloseTo(50, 5); // 20 + 30
    });

    it('ignores finished members entirely', () => {
      const now = Date.now();
      const e = entry({
        members: [
          member({ memberId: 'm1', status: 'SERVED', serviceDuration: 30, servedAt: new Date(now - 40 * 60_000).toISOString() }),
          member({ memberId: 'm2', status: 'NO_SHOW', serviceDuration: 30 }),
          member({ memberId: 'm3', status: 'SERVING', serviceDuration: 30, servedAt: new Date(now - 5 * 60_000).toISOString() }),
        ],
      });
      expect(entryRemainingMinutes(e, now)).toBeCloseTo(25, 5);
    });

    it('treats an in-chair member with no servedAt as just started', () => {
      const e = entry({
        members: [member({ memberId: 'm1', status: 'SERVING', serviceDuration: 30, servedAt: null })],
      });
      expect(entryRemainingMinutes(e, Date.now())).toBe(30);
    });
  });

  describe('computeMemberWaitMinutes', () => {
    it('gives the serving member 0 and floors their remainder at 0 during an overrun (never negative)', () => {
      const c = ctx({
        timeline: [
          entry({
            entryId: 'serving',
            estimatedWaitMinutes: 0,
            members: [member({ memberId: 'sm', status: 'SERVING', serviceDuration: 30 })],
          }),
        ],
        servingElapsedMs: 90 * 60_000, // 60m overrun on a 30m booking
        servingBookedMinutes: 30,
      });
      const waits = computeMemberWaitMinutes(c);
      expect(waits.get('sm')).toBe(0);
    });

    it('never produces a negative wait for the next member behind an overrunning serving member', () => {
      const c = ctx({
        timeline: [
          entry({
            entryId: 'serving',
            estimatedWaitMinutes: 0,
            members: [
              member({ memberId: 'sm', status: 'SERVING', serviceDuration: 30 }),
              member({ memberId: 'sm2', status: 'WAITING', serviceDuration: 20 }),
            ],
          }),
        ],
        servingElapsedMs: 90 * 60_000, // 60m overrun
        servingBookedMinutes: 30,
      });
      const waits = computeMemberWaitMinutes(c);
      // Without the Math.max(0, ...) floor on pendingDuration, a 60m overrun
      // on a 30m booking would leave pendingDuration at -60 here — sm2 (next
      // in the SAME chair) would read as a large NEGATIVE wait rather than
      // "about to go" (0). The floor guarantees it never goes below 0.
      expect(waits.get('sm2')).toBe(0);
      expect(waits.get('sm2')!).toBeGreaterThanOrEqual(0);
    });

    it('accumulates a later waiting member normally when the serving member has NOT overrun', () => {
      const c = ctx({
        timeline: [
          entry({
            entryId: 'serving',
            estimatedWaitMinutes: 0,
            members: [
              member({ memberId: 'sm', status: 'SERVING', serviceDuration: 30 }),
              member({ memberId: 'sm2', status: 'WAITING', serviceDuration: 20 }),
            ],
          }),
        ],
        servingElapsedMs: 10 * 60_000, // 10m elapsed on the SERVING member's own clock
        servingBookedMinutes: 30, // that member's own booking, not the party total
      });
      const waits = computeMemberWaitMinutes(c);
      // Per-member: sm2 waits only for sm's own remainder — 30 - 10 = 20.
      // NOT the whole party's total (30+20-10=40); each member is consumed
      // independently, on their own clock (see wait-time.ts's header comment
      // and servingElapsedMsFor/servingBookedMinutesFor above).
      expect(waits.get('sm2')).toBe(20);
    });

    // THE REPORTED BUG (party of 3 x 5min, member 1 just started): member 2
    // showed 15m and member 3 showed 20m — both 10m too high — because the
    // old code seeded pendingDuration from the WHOLE party's total duration,
    // then the loop below ALSO added every later member's own duration on
    // top of that same total, double-counting them. Per-member, only the
    // in-chair member's own remainder seeds pendingDuration; the loop's own
    // accumulation is what accounts for members ahead in line.
    it('does not double-count later members\' own durations into the currently-serving member\'s remainder', () => {
      const c = ctx({
        timeline: [
          entry({
            entryId: 'serving',
            estimatedWaitMinutes: 0,
            members: [
              member({ memberId: 'm1', status: 'SERVING', serviceDuration: 5 }),
              member({ memberId: 'm2', status: 'WAITING', serviceDuration: 5 }),
              member({ memberId: 'm3', status: 'WAITING', serviceDuration: 5 }),
            ],
          }),
        ],
        servingElapsedMs: 0, // m1 just started
        servingBookedMinutes: 5, // m1's own booking
      });
      const waits = computeMemberWaitMinutes(c);
      expect(waits.get('m1')).toBe(0); // currently serving
      expect(waits.get('m2')).toBe(5); // m1's own remainder
      expect(waits.get('m3')).toBe(10); // plus m2's own duration once m2 starts
    });

    it('seeds from the in-chair member\'s own remainder even in a mixed-duration party', () => {
      const c = ctx({
        timeline: [
          entry({
            entryId: 'serving',
            estimatedWaitMinutes: 0,
            members: [
              member({ memberId: 'm1', status: 'SERVING', serviceDuration: 15 }),
              member({ memberId: 'm2', status: 'WAITING', serviceDuration: 20 }),
              member({ memberId: 'm3', status: 'WAITING', serviceDuration: 25 }),
            ],
          }),
        ],
        servingElapsedMs: 10 * 60_000, // 10m into m1's own 15m booking
        servingBookedMinutes: 15,
      });
      const waits = computeMemberWaitMinutes(c);
      expect(waits.get('m1')).toBe(0); // currently serving
      expect(waits.get('m2')).toBe(5); // m1's own remainder: 15 - 10
      expect(waits.get('m3')).toBe(5 + 20); // plus m2's own duration once m2 starts
    });

    it('accounts for members ahead within a waiting entry (pendingDuration accumulation)', () => {
      const c = ctx({
        timeline: [
          entry({
            entryId: 'w1',
            estimatedWaitMinutes: 30,
            members: [
              member({ memberId: 'w1a', status: 'WAITING', serviceDuration: 15 }),
              member({ memberId: 'w1b', status: 'WAITING', serviceDuration: 25 }),
            ],
          }),
        ],
      });
      const waits = computeMemberWaitMinutes(c);
      expect(waits.get('w1a')).toBe(30); // entry's own live wait
      expect(waits.get('w1b')).toBe(30 + 15); // plus the member ahead of them
    });

    it('gives a SERVED member 0', () => {
      const c = ctx({
        timeline: [
          entry({
            entryId: 'w1',
            estimatedWaitMinutes: 30,
            members: [member({ memberId: 'done', status: 'SERVED' })],
          }),
        ],
      });
      expect(computeMemberWaitMinutes(c).get('done')).toBe(0);
    });

    it('matches computeLiveWaitMinutes for a single-member waiting entry', () => {
      const c = ctx({
        timeline: [entry({ entryId: 'w1', estimatedWaitMinutes: 45, members: [member({ memberId: 'w1m' })] })],
        sinceSnapshotMs: 5 * 60_000,
      });
      expect(computeMemberWaitMinutes(c).get('w1m')).toBe(computeLiveWaitMinutes(c).get('w1'));
    });
  });

  describe('formatWait', () => {
    it('shows "< 1m" for anything under a minute', () => {
      expect(formatWait(0)).toBe('< 1m');
      expect(formatWait(0.5)).toBe('< 1m');
    });

    it('shows minutes only under an hour', () => {
      expect(formatWait(45)).toBe('45m');
    });

    it('shows hours and minutes at or over an hour', () => {
      expect(formatWait(90)).toBe('1h 30m');
    });
  });
});
