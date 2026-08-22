import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { signal } from '@angular/core';
import { SalonVisitService } from './salon-visit.service';
import { QueueSocketService } from '../../core/socket/queue-socket.service';
import { ServerClockService } from '../../core/clock/server-clock.service';

// Mocking socket.io-client here is NOT about this file's own assertions — the
// QueueSocketService below is stubbed, so nothing here touches a socket.
//
// It is about load order. This file imports SalonVisitService, which pulls in
// QueueSocketService, which imports socket.io-client. vi.mock is hoisted and
// module-scoped: whichever spec loads the module FIRST wins for the whole
// worker. When this file won that race, queue-socket.service.spec's own mock
// was bypassed, its fakeSocket never got wired, and all six of its assertions
// failed with "Number of calls: 0" — an intermittent failure in a spec this
// change never touched. Declaring the same mock here makes the module mocked
// no matter which file loads first.
vi.mock('socket.io-client', () => ({
  io: () => ({ connected: true, on: () => {}, emit: () => {}, disconnect: () => {} }),
}));

// These tests reach watchQueue() via _resumeQueueWatch, so QueueSocketService
// is stubbed outright to keep the file hermetic.
function fakeSocket() {
  return {
    watchQueue: vi.fn(),
    unwatchQueue: vi.fn(),
    watchQueueAsStaff: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    lastTimeline: vi.fn(() => null),
    timeline$: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) })),
    queueStatus$: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) })),
    connectionState$: { subscribe: () => ({ unsubscribe: () => {} }) },
  };
}

// Covers the per-slug salon cache added to init()/_loadSalon().
//
// The bug this replaced: a single _loadedSlug slot meant only the most recent
// salon was remembered, so A -> B -> A refetched A every time. These tests
// drive the service through real HTTP (HttpTestingController) rather than
// poking the private Map, so they assert the behaviour a user actually gets:
// "was a request made, or not".
function salonBody(slug: string, salonId: string, queueId = 'q-' + salonId): any {
  return {
    salon: { id: salonId, slug, name: 'Salon ' + slug },
    staff: [{ id: 'st-' + salonId, queueId }],
  };
}

describe('SalonVisitService — per-slug salon cache', () => {
  let svc: SalonVisitService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: QueueSocketService, useValue: fakeSocket() },
        // init() would otherwise start a real 1s setInterval. Even with
        // destroy() in afterEach, keeping the timer from ever existing is what
        // makes this file leak nothing into the shared Vitest worker.
        {
          provide: ServerClockService,
          useValue: { start: () => {}, stop: () => {}, sync: () => {}, tick: signal(0), now: () => Date.now() },
        },
      ],
    });
    svc = TestBed.inject(SalonVisitService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // init() starts ServerClockService's 1s setInterval. Without this stop,
    // every test here leaked a live timer into the shared Vitest worker, which
    // then fired during unrelated specs — that is what made
    // queue-socket.service.spec's emit-call assertions fail intermittently.
    svc.destroy();
  });

  /** Drives a full cold load for `slug`, flushing both requests. */
  function coldLoad(slug: string, salonId: string, services: any[] = [{ id: 'svc1' }]): void {
    svc.init(slug);
    httpMock.expectOne((r) => r.url.includes(`/salons/slug/${slug}`) || r.url.includes(slug))
      .flush(salonBody(slug, salonId));
    httpMock.expectOne((r) => r.url.includes('/services')).flush(services);
  }

  it('refetches nothing when returning to a salon visited two salons ago (the reported bug)', () => {
    coldLoad('salon-a', 'a1');
    coldLoad('salon-b', 'b1');

    // Back to A. With the old single-slot cache this refetched, because B had
    // overwritten the one remembered slug.
    svc.init('salon-a');
    httpMock.expectNone((r) => r.url.includes('salon-a'));
    httpMock.expectNone((r) => r.url.includes('/services'));

    expect(svc.salonData()?.salon.id).toBe('a1');
    expect(svc.services()).toEqual([{ id: 'svc1' }]);
    expect(svc.loading()).toBe(false);
    expect(svc.servicesLoading()).toBe(false);
  });

  it('caches each salon independently rather than keeping only the latest', () => {
    coldLoad('salon-a', 'a1', [{ id: 'svc-a' }]);
    coldLoad('salon-b', 'b1', [{ id: 'svc-b' }]);

    svc.init('salon-a');
    expect(svc.services()).toEqual([{ id: 'svc-a' }]);

    svc.init('salon-b');
    expect(svc.services()).toEqual([{ id: 'svc-b' }]);

    httpMock.verify(); // neither revisit issued a request
  });

  // Ages an existing cache entry by rewriting its fetchedAt, rather than
  // mocking Date.now globally — a global mock also freezes Angular's HTTP
  // internals and breaks request matching.
  function ageCacheEntry(slug: string, byMs: number): void {
    const cache = (svc as any)._salonCache as Map<string, { fetchedAt: number }>;
    const entry = cache.get(slug)!;
    cache.set(slug, { ...entry, fetchedAt: entry.fetchedAt - byMs });
  }

  it('refetches once the 5-minute TTL has expired', () => {
    coldLoad('salon-a', 'a1');
    ageCacheEntry('salon-a', 5 * 60 * 1000 + 1);
    // Navigate away first: while a salon is still the loaded one, init()
    // short-circuits before the cache is ever consulted (it keeps the live
    // page intact). The TTL only governs a genuine RETURN to a salon.
    coldLoad('salon-b', 'b1');

    svc.init('salon-a');
    httpMock.expectOne((r) => r.url.includes('salon-a')).flush(salonBody('salon-a', 'a1'));
    httpMock.expectOne((r) => r.url.includes('/services')).flush([{ id: 'svc1' }]);
    expect(svc.salonData()?.salon.id).toBe('a1');
  });

  it('serves from cache just inside the TTL boundary', () => {
    coldLoad('salon-a', 'a1');
    ageCacheEntry('salon-a', 5 * 60 * 1000 - 1000);
    coldLoad('salon-b', 'b1');

    svc.init('salon-a');
    httpMock.expectNone((r) => r.url.includes('salon-a'));
    expect(svc.salonData()?.salon.id).toBe('a1');
  });

  it('never expires the salon currently on screen, however long it stays open', () => {
    coldLoad('salon-a', 'a1');
    ageCacheEntry('salon-a', 60 * 60 * 1000);

    // Re-init on the SAME slug (e.g. a child route re-running init) must not
    // tear down a live page just because the cache entry aged out.
    svc.init('salon-a');
    httpMock.verify();
    expect(svc.salonData()?.salon.id).toBe('a1');
  });

  it('shows a loading state for services when switching to an uncached salon', () => {
    coldLoad('salon-a', 'a1');
    expect(svc.servicesLoading()).toBe(false);

    // Switching salons must re-arm servicesLoading. Previously it stayed false
    // from the previous salon while services was cleared to [], so the Services
    // tab rendered "no services" instead of a spinner.
    svc.init('salon-b');
    expect(svc.servicesLoading()).toBe(true);
    expect(svc.services()).toEqual([]);
  });

  it('does not paint a slow response after the user switched salons', () => {
    // Start A, but never flush it.
    svc.init('salon-a');
    const reqA = httpMock.expectOne((r) => r.url.includes('salon-a'));

    // User switches to B and B completes.
    coldLoad('salon-b', 'b1', [{ id: 'svc-b' }]);
    expect(svc.salonData()?.salon.id).toBe('b1');

    // A's response finally lands. It must not repaint over B.
    reqA.flush(salonBody('salon-a', 'a1'));
    expect(svc.salonData()?.salon.id).toBe('b1');
    expect(svc.services()).toEqual([{ id: 'svc-b' }]);
  });

  it('still caches an abandoned salon so the next visit is instant', () => {
    svc.init('salon-a');
    const reqA = httpMock.expectOne((r) => r.url.includes('salon-a'));

    svc.init('salon-b');
    const reqB = httpMock.expectOne((r) => r.url.includes('salon-b'));

    // A lands late — not painted, but its services fetch still runs and the
    // entry is keyed by A's own slug, so A caches correctly.
    reqA.flush(salonBody('salon-a', 'a1'));
    httpMock.expectOne((r) => r.url.includes('/services')).flush([{ id: 'svc-a' }]);

    reqB.flush(salonBody('salon-b', 'b1'));
    httpMock.expectOne((r) => r.url.includes('/services')).flush([{ id: 'svc-b' }]);

    // Returning to A is now a cache hit despite A never having been displayed.
    svc.init('salon-a');
    httpMock.expectNone((r) => r.url.includes('salon-a'));
    expect(svc.services()).toEqual([{ id: 'svc-a' }]);
  });

  it('does not cache a salon whose services call failed', () => {
    svc.init('salon-a');
    httpMock.expectOne((r) => r.url.includes('salon-a')).flush(salonBody('salon-a', 'a1'));
    httpMock.expectOne((r) => r.url.includes('/services'))
      .flush('boom', { status: 500, statusText: 'Server Error' });

    // A half-populated entry would serve an empty Services tab for the whole
    // TTL, so nothing is cached and the next visit refetches.
    svc.init('salon-b');
    svc.init('salon-a');
    httpMock.expectOne((r) => r.url.includes('salon-a')).flush(salonBody('salon-a', 'a1'));
  });

  it('clear() drops every cached salon so a new session refetches', () => {
    coldLoad('salon-a', 'a1');
    coldLoad('salon-b', 'b1');

    svc.clear();

    svc.init('salon-a');
    httpMock.expectOne((r) => r.url.includes('salon-a')).flush(salonBody('salon-a', 'a1'));
  });

  it('re-entering the same salon back-to-back is a no-op, not a cache read', () => {
    coldLoad('salon-a', 'a1');
    const salonRef = svc.salonData();

    // Same slug still loaded — init() short-circuits before touching the cache,
    // preserving live queue state (the position-page -> back -> position-page
    // case the original guard existed for).
    svc.init('salon-a');
    expect(svc.salonData()).toBe(salonRef);
    httpMock.verify();
  });
});
