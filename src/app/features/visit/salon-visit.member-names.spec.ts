import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SalonVisitService } from './salon-visit.service';
import { TimelineEntryDto } from '../../core/socket/socket.types';

function tm(over: any = {}): any {
  return { isLeader: false, memberId: 'x', memberName: '', phone: null, servedAt: null,
    serviceDuration: 30, serviceId: 's', serviceName: 'Cut', status: 'WAITING',
    updatedAt: new Date().toISOString(), ...over };
}
function frame(members: any[]): TimelineEntryDto {
  return { entryId: 'entry1', estimatedWaitMinutes: 10, isUpcoming: false, position: 1,
    scheduledAt: null, type: 'WALK_IN', updatedAt: new Date().toISOString(), members } as TimelineEntryDto;
}

describe('member names survive a member being REMOVED from the party', () => {
  let svc: SalonVisitService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    svc = TestBed.inject(SalonVisitService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('keeps the right name on the right person after the middle member is removed', () => {
    svc.joinQueue('salon1', 'queue1', 'slug', {
      members: [{ memberName: 'Amaka' }, { memberName: 'Bola' }, { memberName: 'Chidi' }],
    } as any);
    httpMock.expectOne((r) => r.url.includes('/walk-in'))
      .flush({ guestToken: null, entry: { id: 'entry1', queueId: 'queue1' } });

    // First frame: all three present, redacted. Binds position -> memberId.
    const full = frame([
      tm({ memberId: 'id-A', isLeader: true }),
      tm({ memberId: 'id-B' }),
      tm({ memberId: 'id-C' }),
    ]);
    (svc as any)._reconcileEntries('queue1', [full], true);
    svc.timeline.set([full]);

    expect(svc.partyMembers('entry1').map((m) => m.memberName))
      .toEqual(['Amaka', 'Bola', 'Chidi']);

    // Bola (middle) is REMOVED — disappears from the array entirely.
    const afterRemoval = frame([
      tm({ memberId: 'id-A', isLeader: true }),
      tm({ memberId: 'id-C' }),
    ]);
    (svc as any)._reconcileEntries('queue1', [afterRemoval], false);
    svc.timeline.set([afterRemoval]);

    // Chidi must still be Chidi. Position-keyed would have said 'Bola'.
    expect(svc.partyMembers('entry1').map((m) => m.memberName))
      .toEqual(['Amaka', 'Chidi']);
  });

  it('binding is idempotent across repeated frames', () => {
    svc.joinQueue('salon1', 'queue1', 'slug', {
      members: [{ memberName: 'Amaka' }, { memberName: 'Bola' }],
    } as any);
    httpMock.expectOne((r) => r.url.includes('/walk-in'))
      .flush({ guestToken: null, entry: { id: 'entry1', queueId: 'queue1' } });

    const f = frame([tm({ memberId: 'id-A', isLeader: true }), tm({ memberId: 'id-B' })]);
    for (let i = 0; i < 5; i++) (svc as any)._reconcileEntries('queue1', [f], i === 0);
    svc.timeline.set([f]);

    expect(svc.partyMembers('entry1').map((m) => m.memberName)).toEqual(['Amaka', 'Bola']);
  });

  it('leaves a non-blank server name untouched', () => {
    svc.joinQueue('salon1', 'queue1', 'slug', { members: [{ memberName: 'Amaka' }] } as any);
    httpMock.expectOne((r) => r.url.includes('/walk-in'))
      .flush({ guestToken: null, entry: { id: 'entry1', queueId: 'queue1' } });

    const f = frame([tm({ memberId: 'id-A', isLeader: true, memberName: 'Server Name' })]);
    (svc as any)._reconcileEntries('queue1', [f], true);
    svc.timeline.set([f]);

    expect(svc.partyMembers('entry1')[0].memberName).toBe('Server Name');
  });
});
