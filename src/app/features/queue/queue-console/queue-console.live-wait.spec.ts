import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { QueueConsoleService } from './queue-console.service';
import { TimelineEntryDto } from '../../../core/socket/socket.types';
import { TimelineMemberDto } from '../../../api/models/timeline-member-dto';

// FALSIFICATION CHECK (wait-time-extraction.md, "Check 1") — this pins down
// TODAY'S liveWaitMinutes/memberWaitMinutes formula against the reported bug:
// a barber overruns a serving client's booked duration with no new socket
// frame, and every WAITING entry behind them collapses toward "< 1m" in
// lockstep, even though only the entry actually next in line should reach it.
//
// Root cause (see the plan): estimatedWaitMinutes from the backend already
// has elapsed-since-servedAt subtracted (timeline.service.ts's
// remainingDurationOf + buildTimeline's accumulatedWaitMinutes). The frontend
// then subtracts elapsedMinutes AGAIN in liveWaitMinutes — a double
// subtraction that hits every waiting entry's estimatedWaitMinutes equally,
// so they all shrink together regardless of their position in line.
//
// This test must FAIL against today's code. If it passes, the
// double-subtraction diagnosis is wrong and the plan needs revisiting.

function member(over: Partial<TimelineMemberDto> = {}): TimelineMemberDto {
  return {
    isLeader: true,
    memberId: 'm1',
    memberName: 'Client',
    phone: null,
    email: null,
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

describe('QueueConsoleService — liveWaitMinutes double-subtraction (falsification check)', () => {
  let svc: QueueConsoleService;
  let asAny: {
    liveWaitMinutes: () => Map<string, number>;
    _serverTimeline: { set(v: TimelineEntryDto[]): void };
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [QueueConsoleService, provideHttpClient(), provideRouter([])],
    });
    svc = TestBed.inject(QueueConsoleService);
    asAny = svc as unknown as typeof asAny;
  });

  // The exact screenshot scenario: 1 serving (booked 30m, servedAt 90m ago —
  // a 60m overrun with no new frame) + 3 waiting entries at snapshotted
  // estimatedWaitMinutes of 30/60/90 (as the backend would have sent at the
  // moment the frame landed, BEFORE any local elapsed-time math is applied).
  it('does NOT collapse every waiting entry toward 0 during a serving overrun', () => {
    const now = Date.now();
    const servingServedAt = new Date(now - 90 * 60_000).toISOString(); // 90m elapsed, 30m booked → 60m overrun

    asAny._serverTimeline.set([
      entry({
        entryId: 'serving',
        position: 0,
        estimatedWaitMinutes: 0,
        members: [member({ memberId: 'sm', status: 'SERVING', servedAt: servingServedAt, serviceDuration: 30 })],
      }),
      entry({
        entryId: 'w1',
        position: 1,
        estimatedWaitMinutes: 30,
        members: [member({ memberId: 'w1m' })],
      }),
      entry({
        entryId: 'w2',
        position: 2,
        estimatedWaitMinutes: 60,
        members: [member({ memberId: 'w2m' })],
      }),
      entry({
        entryId: 'w3',
        position: 3,
        estimatedWaitMinutes: 90,
        members: [member({ memberId: 'w3m' })],
      }),
    ]);

    const waits = asAny.liveWaitMinutes();

    // Only the entry actually next in line may legitimately read near 0.
    // Entries further back must still reflect real, differentiated waits —
    // NOT all collapsed to the same near-0 value.
    const w2Wait = waits.get('w2') ?? 0;
    const w3Wait = waits.get('w3') ?? 0;

    expect(w2Wait).toBeGreaterThan(1);
    expect(w3Wait).toBeGreaterThan(1);
    // w3 (further back) must read higher than w2 — today's bug collapses
    // both toward the same near-0 floor, erasing this ordering.
    expect(w3Wait).toBeGreaterThan(w2Wait);
  });
});
