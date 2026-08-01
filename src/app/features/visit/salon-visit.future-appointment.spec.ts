import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SalonVisitService } from './salon-visit.service';
import { ActiveEntryStore } from '../../core/queue/active-entry.store';

// The live timeline only carries entries scheduled for TODAY, so an
// appointment booked for a later day is absent from every frame until its day
// arrives. _reconcileEntries must not read that absence as "finished" and
// delete the stored entry — doing so loses the booking from My Queues and from
// the position page, which reads it back to render the scheduled time.
describe('a future-day appointment survives timeline reconciliation', () => {
  let svc: SalonVisitService;
  let store: ActiveEntryStore;
  let httpMock: HttpTestingController;

  function daysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    svc = TestBed.inject(SalonVisitService);
    store = TestBed.inject(ActiveEntryStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('keeps an entry booked for a later day, even though it is in no frame', () => {
    store.save({
      queueId: 'queue1',
      entryId: 'future-entry',
      salonId: 'salon1',
      salonSlug: 'slug',
      type: 'APPOINTMENT',
      scheduledAt: daysFromNow(7),
    });

    // Frame carries other people's entries; ours is legitimately not in it.
    (svc as any)._reconcileEntries('queue1', [], true);

    expect(store.getByEntryId('future-entry')).not.toBeNull();
    expect(svc.isMine('future-entry')).toBe(true);
  });

  it('still drops a finished walk-in that has left the timeline', () => {
    store.save({
      queueId: 'queue1',
      entryId: 'walkin-entry',
      salonId: 'salon1',
      salonSlug: 'slug',
      type: 'WALK_IN',
    });

    (svc as any)._reconcileEntries('queue1', [], true);

    expect(store.getByEntryId('walkin-entry')).toBeNull();
    expect(svc.isMine('walkin-entry')).toBe(false);
  });

  it('drops a TODAY appointment once it leaves the timeline (it was served)', () => {
    const laterToday = new Date();
    laterToday.setHours(23, 0, 0, 0);
    store.save({
      queueId: 'queue1',
      entryId: 'today-entry',
      salonId: 'salon1',
      salonSlug: 'slug',
      type: 'APPOINTMENT',
      scheduledAt: laterToday.toISOString(),
    });

    (svc as any)._reconcileEntries('queue1', [], true);

    expect(store.getByEntryId('today-entry')).toBeNull();
  });

  it('survives repeated frames rather than being dropped on a later one', () => {
    store.save({
      queueId: 'queue1',
      entryId: 'future-entry',
      salonId: 'salon1',
      salonSlug: 'slug',
      type: 'APPOINTMENT',
      scheduledAt: daysFromNow(3),
    });

    for (let i = 0; i < 5; i++) (svc as any)._reconcileEntries('queue1', [], i === 0);

    expect(store.getByEntryId('future-entry')).not.toBeNull();
  });

  afterEach(() => httpMock.verify());
});

// Holding an appointment must not block joining the walk-in line for the same
// barber. Those are different things: a booking reserves a later slot, while
// joining the queue is about right now, and customers legitimately want both.
// selectBarber() previously redirected on ANY stored entry for the queue, so a
// booking made the Join button silently navigate to the position page instead
// of opening the join dialog, until that appointment was served or cancelled.
describe('selectBarber gates on walk-ins only, not appointments', () => {
  let svc: SalonVisitService;
  let store: ActiveEntryStore;
  let httpMock: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;

  const STAFF = { queueId: 'queue1', staffId: 'staff1' } as any;

  function daysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    svc = TestBed.inject(SalonVisitService);
    store = TestBed.inject(ActiveEntryStore);
    httpMock = TestBed.inject(HttpTestingController);

    navigate = vi.fn();
    (svc as any)._router = { navigate };
    // selectBarber's early returns: pretend a signed-in caller and an open
    // salon so the test exercises the entry gate rather than those.
    (svc as any)._currentUser = { user: () => ({ id: 'u1' }) };
    svc.salonData.set({ isOpen: true, salon: { id: 'salon1', slug: 'slug' }, staff: [] } as any);
  });

  it('opens the join dialog when the only entry is a future appointment', () => {
    store.save({
      queueId: 'queue1',
      entryId: 'appointment-entry',
      salonId: 'salon1',
      salonSlug: 'slug',
      type: 'APPOINTMENT',
      scheduledAt: daysFromNow(7),
    });

    expect(svc.selectBarber(STAFF, 'slug')).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still redirects to the position page when a walk-in is already in the queue', () => {
    store.save({
      queueId: 'queue1',
      entryId: 'walkin-entry',
      salonId: 'salon1',
      salonSlug: 'slug',
      type: 'WALK_IN',
    });

    expect(svc.selectBarber(STAFF, 'slug')).toBe(false);
    expect(navigate).toHaveBeenCalled();
  });

  it('redirects to the WALK-IN when the caller holds both it and an appointment', () => {
    store.save({
      queueId: 'queue1',
      entryId: 'appointment-entry',
      salonId: 'salon1',
      salonSlug: 'slug',
      type: 'APPOINTMENT',
      scheduledAt: daysFromNow(7),
    });
    store.save({
      queueId: 'queue1',
      entryId: 'walkin-entry',
      salonId: 'salon1',
      salonSlug: 'slug',
      type: 'WALK_IN',
    });

    expect(svc.selectBarber(STAFF, 'slug')).toBe(false);
    // The route segments must name the walk-in, not the appointment.
    expect(JSON.stringify(navigate.mock.calls[0])).toContain('walkin-entry');
    expect(JSON.stringify(navigate.mock.calls[0])).not.toContain('appointment-entry');
  });

  // Entries persisted before `type` existed are still in real localStorage.
  // isAppointmentEntry falls back to scheduledAt for them, so an old booking
  // must not start blocking joins just because it predates the field.
  it('treats a legacy appointment (no type, scheduledAt only) as an appointment', () => {
    store.save({
      queueId: 'queue1',
      entryId: 'legacy-appointment',
      salonId: 'salon1',
      salonSlug: 'slug',
      scheduledAt: daysFromNow(7),
    });

    expect(svc.selectBarber(STAFF, 'slug')).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('treats a legacy walk-in (no type, no scheduledAt) as a walk-in', () => {
    store.save({
      queueId: 'queue1',
      entryId: 'legacy-walkin',
      salonId: 'salon1',
      salonSlug: 'slug',
    });

    expect(svc.selectBarber(STAFF, 'slug')).toBe(false);
    expect(navigate).toHaveBeenCalled();
  });

  afterEach(() => httpMock.verify());
});
