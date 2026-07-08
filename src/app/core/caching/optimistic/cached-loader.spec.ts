import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Observable, of, throwError, Subject } from 'rxjs';
import { vi } from 'vitest';
import { CachedLoader } from './cached-loader';
import { OptimisticService } from './optimistic.service';
import { ToastService } from '../../toast/toast.service';

function fakeToast() { return { success: vi.fn(), error: vi.fn(), info: vi.fn() }; }

describe('CachedLoader', () => {
  let optimistic: OptimisticService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OptimisticService, { provide: ToastService, useValue: fakeToast() }],
    });
    optimistic = TestBed.inject(OptimisticService);
  });

  function makeLoader<T>(
    initial: T,
    fetchFn: (key: string) => Observable<T>,
    opts: { shouldCache?: (v: T) => boolean } = {},
  ) {
    const sig = signal<T>(initial);
    const cache = new Map<string, T>();
    const loader = new CachedLoader<T>({
      signal: sig,
      optimistic,
      cache,
      fetch: fetchFn,
      ...opts,
    });
    return { sig, cache, loader };
  }

  // 1. Cache miss → fetch → signal updated, cache populated
  it('cache miss: fetches and updates signal and cache', () => {
    const { sig, cache, loader } = makeLoader<string[]>([], () => of(['a', 'b']));
    loader.load('key1');
    expect(sig()).toEqual(['a', 'b']);
    expect(cache.get('key1')).toEqual(['a', 'b']);
  });

  // 2. Cache hit → commitRead, no second fetch
  it('cache hit: commits to signal without fetching', () => {
    let fetchCount = 0;
    const { sig, cache, loader } = makeLoader<string[]>([], () => { fetchCount++; return of(['server']); });
    loader.load('key1'); // miss → fetch
    expect(fetchCount).toBe(1);
    sig.set([]); // simulate reset to make the cache-hit visible
    loader.load('key1'); // hit → no fetch
    expect(fetchCount).toBe(1);
    expect(sig()).toEqual(['server']);
  });

  // 3. Inflight guard: second load() for same key while first is in flight → no duplicate GET
  it('inflight guard: second load() for same key is dropped while first is in flight', () => {
    let fetchCount = 0;
    const subject = new Subject<string[]>();
    const { loader } = makeLoader<string[]>([], () => { fetchCount++; return subject.asObservable(); });
    loader.load('key1');
    expect(fetchCount).toBe(1);
    loader.load('key1'); // still in flight — must be dropped
    expect(fetchCount).toBe(1); // NOT 2
  });

  // 4. Different context keys are independent — no cross-key blocking
  it('different context keys: load independently', () => {
    let fetchCount = 0;
    const { loader } = makeLoader<string[]>([], () => { fetchCount++; return of([]); });
    loader.load('key1');
    loader.load('key2');
    expect(fetchCount).toBe(2);
  });

  // 5. loading signal: true during fetch, false after
  it('loading: true during fetch, false on success', () => {
    const subject = new Subject<string[]>();
    const { loader } = makeLoader<string[]>([], () => subject.asObservable());
    loader.load('key1');
    expect(loader.loading()).toBe(true);
    subject.next(['x']); subject.complete();
    expect(loader.loading()).toBe(false);
  });

  it('loading: false after error', () => {
    const { loader } = makeLoader<string[]>([], () => throwError(() => new Error('fail')));
    loader.load('key1');
    expect(loader.loading()).toBe(false);
  });

  // 6. error signal: set on failure, cleared on next load attempt
  it('error: set true on failure', () => {
    const { loader } = makeLoader<string[]>([], () => throwError(() => new Error('fail')));
    loader.load('key1');
    expect(loader.error()).toBe(true);
  });

  it('error: cleared (false) when a subsequent load starts', () => {
    let call = 0;
    const { loader } = makeLoader<string[]>([], () => {
      call++;
      // First two calls fail: call 1 = initial attempt, call 2 = retry(1) — both exhaust
      if (call <= 2) return throwError(() => new Error('fail'));
      return of(['ok']); // call 3 = second loader.load() invocation succeeds
    });
    loader.load('key1'); // 2 attempts via retry(1), both fail
    expect(loader.error()).toBe(true);
    // cache miss, not inflight — triggers a fresh fetch (call 3 → success)
    loader.load('key1');
    expect(loader.error()).toBe(false);
    expect(loader.loading()).toBe(false);
  });

  // 7. refresh(): bypasses cache and inflight guard, forces fetch
  it('refresh: fetches even when cache has data', () => {
    let fetchCount = 0;
    const { loader } = makeLoader<string[]>([], () => { fetchCount++; return of([]); });
    loader.load('key1'); // populates cache
    expect(fetchCount).toBe(1);
    loader.refresh('key1');
    expect(fetchCount).toBe(2); // must fetch again
  });

  it('refresh: bypasses inflight guard', () => {
    let fetchCount = 0;
    const subject = new Subject<string[]>();
    const { loader } = makeLoader<string[]>([], () => { fetchCount++; return subject.asObservable(); });
    loader.load('key1'); // in flight
    loader.refresh('key1'); // must fire despite inflight
    expect(fetchCount).toBe(2);
  });

  // 8. mirrorFn: returned function writes value to cache
  it('mirrorFn: writes value to cache when called', () => {
    const { cache, loader } = makeLoader<string[]>([], () => of([]));
    const mirror = loader.mirrorFn('key1');
    mirror(['x', 'y']);
    expect(cache.get('key1')).toEqual(['x', 'y']);
  });

  it('mirrorFn is used by run() via the engine — mutation recompute writes to cache', () => {
    const { sig, cache, loader } = makeLoader<string[]>([], () => of(['initial']));
    loader.load('key1');
    expect(cache.get('key1')).toEqual(['initial']);
    // Simulate a mutation using optimistic.run() with mirrorFn
    optimistic.run({
      signal: sig,
      apply: (list) => [...list, 'mutation'],
      mirror: loader.mirrorFn('key1'),
      contextKey: 'key1',
      request: () => of(null),
      dedupeKey: 'test-mirror',
    });
    // After the mutation confirms, the cache should reflect the result
    expect(cache.get('key1')).toContain('mutation');
  });

  // 9. shouldCache: prevents caching null — for nullable signals
  it('shouldCache: null is not written to cache when shouldCache returns false for null', () => {
    const sig = signal<string | null>(null);
    const cache = new Map<string, string | null>();
    const loader = new CachedLoader<string | null>({
      signal: sig,
      optimistic,
      cache,
      fetch: () => of('hello'),
      shouldCache: (v) => v !== null,
    });
    loader.load('key1'); // fetches 'hello'
    expect(cache.get('key1')).toBe('hello'); // stored
    // mirrorFn with null should not store
    loader.mirrorFn('key1')(null);
    expect(cache.get('key1')).toBe('hello'); // unchanged
  });

  // 10. retry(1): one automatic retry before surfacing error
  it('retry(1): one failed attempt followed by success succeeds', () => {
    const { sig, loader } = makeLoader<string[]>([], (() => {
      let calls = 0;
      return () => {
        calls++;
        return calls === 1
          ? throwError(() => new Error('transient'))
          : of(['recovered']);
      };
    })()
    );
    loader.load('key1');
    expect(sig()).toEqual(['recovered']); // retry succeeded
    expect(loader.error()).toBe(false);
  });

  it('retry(1): two consecutive failures surface the error', () => {
    const { loader } = makeLoader<string[]>([], () => throwError(() => new Error('fail')));
    loader.load('key1');
    expect(loader.error()).toBe(true);
  });

  // 11. Optimistic engine integration: commitRead via CachedLoader respects epoch
  it('cache hit after a confirmed write is dropped (epoch moved)', () => {
    const subject = new Subject<string[]>();
    const { sig, cache, loader } = makeLoader<string[]>([], () => subject.asObservable());
    // Start a load — beginRead captures epoch N
    loader.load('key1');
    // A write confirms while the fetch is in flight — bumps the epoch
    optimistic.run({
      signal: sig,
      apply: (list) => [...list, 'write'],
      request: () => of(null),
      dedupeKey: 'test-epoch',
    });
    // The in-flight fetch now resolves — epoch is stale, commitRead drops it
    subject.next(['stale-from-server']); subject.complete();
    expect(sig()).not.toEqual(['stale-from-server']);
    // The write is still in the signal
    expect(sig()).toContain('write');
  });
});
