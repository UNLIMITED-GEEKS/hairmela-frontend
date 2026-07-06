import { TestBed } from '@angular/core/testing';
import { DestroyRef, signal, WritableSignal } from '@angular/core';
import { of, throwError, Subject } from 'rxjs';
import { vi } from 'vitest';
import { OptimisticService } from './optimistic.service';
import { ToastService } from '../toast/toast.service';

type MockToast = { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
function fakeToast(): MockToast { return { success: vi.fn(), error: vi.fn(), info: vi.fn() }; }
function makeSignal<T>(initial: T): WritableSignal<T> { return signal<T>(initial); }

describe('OptimisticService', () => {
  let svc: OptimisticService;
  let toast: MockToast;

  beforeEach(() => {
    const mockToast = fakeToast();
    TestBed.configureTestingModule({
      providers: [OptimisticService, { provide: ToastService, useValue: mockToast }],
    });
    svc = TestBed.inject(OptimisticService);
    toast = mockToast;
  });

  // 1. Basic revert
  it('removes the op and recomputes without it on revert; onRevert fires', () => {
    const sig = makeSignal<number[]>([1, 2]);
    const onRevert = vi.fn();
    svc.run({
      signal: sig, apply: (list) => [...list, 3],
      request: () => throwError(() => ({ error: {} })),
      errorMessage: 'oops', onRevert, dedupeKey: 'test-1',
    });
    expect(sig()).toEqual([1, 2]);
    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('oops');
  });

  // 2. Concurrent ops — first rejects, second survives
  it('two overlapping ops: first rejects, second op state survives throughout', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>();
    const subjectB = new Subject<void>();
    svc.run({ signal: sig, apply: (list) => [...list, 'A'], request: () => subjectA.asObservable(), dedupeKey: 'test-2-a' });
    expect(sig()).toEqual(['A']);
    svc.run({ signal: sig, apply: (list) => [...list, 'B'], request: () => subjectB.asObservable(), dedupeKey: 'test-2-b' });
    expect(sig()).toEqual(['A', 'B']);
    subjectA.error({ error: {} });
    expect(sig()).toEqual(['B']);
    subjectB.next(); subjectB.complete();
    expect(sig()).toEqual(['B']);
  });

  // 3. A read while an op is pending is DEFERRED, not composed. Composing was
  // the v2 design (a cache-hit read would fold in on top of the pending op's
  // replay) — but that's how an un-reconciled optimistic row leaked into a
  // service's own Map cache (via mirror on the instant-paint recompute), got
  // read back by a concurrent load() as if it were server truth, and welded
  // into baseline. When the op later failed, there was nothing left in
  // `pending` to revert — the row survived forever ("no rollback on create
  // failure"). Deferring the read while ops are pending closes that: baseline
  // is untouched until the op settles, and the op's own confirm/revert
  // recompute repaints correctly from the TRUE baseline.
  it('commitRead: read while op is pending is deferred — baseline untouched, op still reverts cleanly', () => {
    const sig = makeSignal<string[]>([]);
    const subject = new Subject<void>();
    const token = svc.beginRead(sig);
    svc.run({ signal: sig, apply: (list) => [...list, 'optimistic'], request: () => subject.asObservable(), dedupeKey: 'test-3' });
    expect(sig()).toEqual(['optimistic']);
    const accepted = svc.commitRead(sig, ['server'], token);
    expect(accepted).toBe(false); // deferred — op still pending
    expect(sig()).toEqual(['optimistic']); // signal unchanged by the deferred read
    subject.error({ error: {} }); // the op now fails
    expect(sig()).toEqual([]); // reverts cleanly to the TRUE baseline ([]), not ['server']
  });

  // 4. Read-clobbers-write
  it('late GET after confirmed delete is dropped — deleted row does not resurrect', () => {
    const sig = makeSignal<string[]>(['initial']);
    const token = svc.beginRead(sig);
    svc.run({ signal: sig, apply: (list) => list.filter((x) => x !== 'initial'), request: () => of(null), dedupeKey: 'test-4' });
    expect(sig()).toEqual([]);
    const accepted = svc.commitRead(sig, ['initial'], token);
    expect(accepted).toBe(false);
    expect(sig()).toEqual([]);
  });

  // 5. Read-clobbers-read
  it('second commitRead accepted; first (stale) dropped — newer data intact', () => {
    const sig = makeSignal<string[]>([]);
    const token1 = svc.beginRead(sig);
    const token2 = svc.beginRead(sig);
    expect(svc.commitRead(sig, ['newer'], token2)).toBe(true);
    expect(sig()).toEqual(['newer']);
    expect(svc.commitRead(sig, ['older'], token1)).toBe(false);
    expect(sig()).toEqual(['newer']);
  });

  // 6a. tempId: pending during flight, gone after confirm
  it('isPending true during flight, false after confirm', () => {
    const sig = makeSignal<string[]>([]);
    const subject = new Subject<void>();
    svc.run({ signal: sig, apply: (list) => [...list, 'temp_123'], request: () => subject.asObservable(), tempId: 'temp_123', dedupeKey: 'test-6a' });
    expect(svc.isPending('temp_123')).toBe(true);
    subject.next(); subject.complete();
    expect(svc.isPending('temp_123')).toBe(false);
  });

  // 6b. tempId: gone after revert
  it('isPending false after revert', () => {
    const sig = makeSignal<string[]>([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'temp_456'], request: () => throwError(() => ({ error: {} })), tempId: 'temp_456', dedupeKey: 'test-6b' });
    expect(svc.isPending('temp_456')).toBe(false);
  });

  // 7a. mirror called on apply and confirm
  it('mirror called on apply; last call after confirm has confirmed value', () => {
    const sig = makeSignal<number[]>([]);
    const mirror = vi.fn();
    const subject = new Subject<void>();
    svc.run({ signal: sig, apply: (list) => [...list, 1], request: () => subject.asObservable(), mirror, dedupeKey: 'test-7a' });
    expect(mirror).toHaveBeenCalledWith([1]);
    subject.next(); subject.complete();
    expect(mirror).toHaveBeenLastCalledWith([1]);
  });

  // 7b. mirror reverts to baseline
  it('mirror receives baseline value after revert', () => {
    const sig = makeSignal<number[]>([10]);
    const mirror = vi.fn();
    svc.run({ signal: sig, apply: (list) => [...list, 99], request: () => throwError(() => ({ error: {} })), mirror, dedupeKey: 'test-7b' });
    const lastCall = mirror.mock.calls[mirror.mock.calls.length - 1][0] as number[];
    expect(lastCall).toEqual([10]);
  });

  // 8. _ledgers is WeakMap (structural)
  it('_ledgers is a WeakMap', () => {
    expect((svc as unknown as { _ledgers: unknown })._ledgers instanceof WeakMap).toBe(true);
  });

  // 9. Context switch — mirror follows new context
  it('context switch: mirror writes to new cache slice, not old', () => {
    const sig = makeSignal<string[]>([]);
    const mirrorA = vi.fn();
    const mirrorB = vi.fn();
    svc.run({ signal: sig, apply: (list) => [...list, 'a'], request: () => of(null), mirror: mirrorA, contextKey: 'A', dedupeKey: 'test-9-a' });
    expect(mirrorA).toHaveBeenCalled();
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'b'], request: () => of(null), mirror: mirrorB, contextKey: 'B', dedupeKey: 'test-9-b' });
    expect(mirrorB).toHaveBeenCalled();
    const lastB = mirrorB.mock.calls[mirrorB.mock.calls.length - 1][0] as string[];
    expect(lastB).toContain('b');
  });

  // 10a. Old-context op confirms — does not touch new context
  it('superseded op (A) confirms after switch to B — signal unchanged', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>();
    svc.run({ signal: sig, apply: (list) => [...list, 'from-A'], request: () => subjectA.asObservable(), contextKey: 'A', dedupeKey: 'test-10a-a' });
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'from-B'], request: () => of(null), contextKey: 'B', dedupeKey: 'test-10a-b' });
    const afterB = sig();
    subjectA.next(); subjectA.complete();
    expect(sig()).toEqual(afterB);
  });

  // 10b. Old-context op errors — toasts but does not touch signal
  it('superseded op (A) errors — toasts, does not touch signal', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>();
    svc.run({ signal: sig, apply: (list) => [...list, 'from-A'], request: () => subjectA.asObservable(), contextKey: 'A', errorMessage: 'A failed', dedupeKey: 'test-10b-a' });
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'from-B'], request: () => of(null), contextKey: 'B', dedupeKey: 'test-10b-b' });
    const afterB = sig();
    subjectA.error({ error: {} });
    expect(toast.error).toHaveBeenCalledWith('A failed');
    expect(sig()).toEqual(afterB);
  });

  // 11. commitRead returns true/false
  it('commitRead returns true when accepted, false when stale', () => {
    const sig = makeSignal<number[]>([]);
    const token = svc.beginRead(sig);
    expect(svc.commitRead(sig, [1], token)).toBe(true);
    expect(svc.commitRead(sig, [2], token)).toBe(false);  // epoch moved
  });

  // 12. A→B→A ping-pong
  it('A→B→A ping-pong: late B read dropped', () => {
    const sig = makeSignal<string>('A');
    svc.beginRead(sig, 'A');
    sig.set('');
    const tokenB = svc.beginRead(sig, 'B');
    sig.set('A');
    svc.beginRead(sig, 'A');
    expect(svc.commitRead(sig, 'B-stale', tokenB)).toBe(false);
    expect(sig()).toBe('A');
  });

  // 13. ABA epoch proof
  it('ABA: old read from incarnation 1 cannot match incarnation 2 epoch', () => {
    const sig = makeSignal<string[]>(['initial']);
    const tokenInc1 = svc.beginRead(sig);
    svc.run({ signal: sig, apply: (list) => list.filter((x) => x !== 'initial'), request: () => of(null), dedupeKey: 'test-13' });
    sig.set([]); svc.beginRead(sig, 'B');
    sig.set(['A-reborn']); svc.beginRead(sig, 'A');
    expect(svc.commitRead(sig, ['should-not-land'], tokenInc1)).toBe(false);
    expect(sig()).toEqual(['A-reborn']);
  });

  // 14. Load-first mirror adoption
  it('beginRead with no mirror; commitRead adopts mirror; subsequent run uses it', () => {
    const sig = makeSignal<string[]>([]);
    const mirror = vi.fn();
    const token = svc.beginRead(sig, 'salon1');
    svc.commitRead(sig, ['from-server'], token, mirror);
    expect(mirror).toHaveBeenCalledWith(['from-server']);
    mirror.mockClear();
    svc.run({ signal: sig, apply: (list) => [...list, 'op'], request: () => of(null), contextKey: 'salon1', dedupeKey: 'test-14' });
    expect(mirror).toHaveBeenCalled();
  });

  // 15. onSettled fires exactly once — all four terminal paths
  it('onSettled fires exactly once on confirm', () => {
    const sig = makeSignal<number[]>([]); let count = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 1], request: () => of(null), onSettled: () => count++, dedupeKey: 'test-15a' });
    expect(count).toBe(1);
  });

  it('onSettled fires exactly once on revert', () => {
    const sig = makeSignal<number[]>([]); let count = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 1], request: () => throwError(() => ({ error: {} })), onSettled: () => count++, dedupeKey: 'test-15b' });
    expect(count).toBe(1);
  });

  it('onSettled fires exactly once on superseded-confirm', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>(); let count = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 'A'], request: () => subjectA.asObservable(), contextKey: 'A', onSettled: () => count++, dedupeKey: 'test-15c-a' });
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'B'], request: () => of(null), contextKey: 'B', dedupeKey: 'test-15c-b' });
    subjectA.next(); subjectA.complete();
    expect(count).toBe(1);
  });

  it('onSettled fires exactly once on superseded-revert', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>(); let count = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 'A'], request: () => subjectA.asObservable(), contextKey: 'A', onSettled: () => count++, dedupeKey: 'test-15d-a' });
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'B'], request: () => of(null), contextKey: 'B', dedupeKey: 'test-15d-b' });
    subjectA.error({ error: {} });
    expect(count).toBe(1);
  });

  // 16. dedupeKey — the double-tap fix. A re-entrant run() with the same key
  // while the first is in flight must be dropped entirely: no second paint,
  // no second request.
  it('dedupeKey: second run() with the same key while in flight is dropped — no paint, no request', () => {
    const sig = makeSignal<string[]>([]);
    const subject = new Subject<void>();
    let requestCount = 0;
    const request = () => { requestCount++; return subject.asObservable(); };
    svc.run({ signal: sig, apply: (list) => [...list, 'row'], request, dedupeKey: 'create:salon1:name' });
    expect(sig()).toEqual(['row']);
    // Second call, same key, first still unsettled — must be a no-op.
    svc.run({ signal: sig, apply: (list) => [...list, 'row'], request, dedupeKey: 'create:salon1:name' });
    expect(sig()).toEqual(['row']); // NOT ['row', 'row']
    expect(requestCount).toBe(1);
  });

  it('dedupeKey: releases on confirm — a later call with the same key runs normally', () => {
    const sig = makeSignal<string[]>([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'first'], request: () => of(null), dedupeKey: 'k' });
    expect(sig()).toEqual(['first']);
    // First has already settled synchronously (of(null)) — key is free again.
    svc.run({ signal: sig, apply: (list) => [...list, 'second'], request: () => of(null), dedupeKey: 'k' });
    expect(sig()).toEqual(['first', 'second']);
  });

  it('dedupeKey: releases on revert — a later call with the same key runs normally', () => {
    const sig = makeSignal<string[]>([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'x'], request: () => throwError(() => ({ error: {} })), dedupeKey: 'k' });
    expect(sig()).toEqual([]); // reverted
    svc.run({ signal: sig, apply: (list) => [...list, 'y'], request: () => of(null), dedupeKey: 'k' });
    expect(sig()).toEqual(['y']); // key was free — this call went through
  });

  it('dedupeKey: releases on teardown even though neither next nor error fired', () => {
    const sig = makeSignal<string[]>([]);
    const subject = new Subject<void>();
    // Fake DestroyRef: capture the callback takeUntilDestroyed registers via
    // onDestroy, so the test can invoke it manually to simulate the component
    // being destroyed mid-flight (real Angular calls this when the injector tears down).
    let destroyCallback: (() => void) | undefined;
    const destroyRef = {
      onDestroy: (cb: () => void) => { destroyCallback = cb; return () => {}; },
      destroyed: false,
    } as unknown as DestroyRef;
    // No next/error/complete ever emitted — simulates a component destroyed mid-flight.
    svc.run({ signal: sig, apply: (list) => [...list, 'row'], request: () => subject.asObservable(), dedupeKey: 'k' }, destroyRef);
    destroyCallback?.(); // fire teardown — takeUntilDestroyed unsubscribes, finalize runs
    let requestCount = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 'row2'], request: () => { requestCount++; return of(null); }, dedupeKey: 'k' });
    expect(requestCount).toBe(1); // second run() was NOT blocked — key was freed
  });

  it('dedupeKey: different keys never block each other', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>();
    const subjectB = new Subject<void>();
    svc.run({ signal: sig, apply: (list) => [...list, 'A'], request: () => subjectA.asObservable(), dedupeKey: 'create:salon1:foo' });
    svc.run({ signal: sig, apply: (list) => [...list, 'B'], request: () => subjectB.asObservable(), dedupeKey: 'create:salon1:bar' });
    expect(sig()).toEqual(['A', 'B']); // both painted — distinct keys, no gating between them
  });

  // 17. The exact real-world regression: a service's own Map cache gets the
  // optimistic row written into it via mirror() on instant-paint, BEFORE the
  // create request settles. If a concurrent load() then does a cache-hit
  // commitRead with that tainted cache value while the create is still
  // pending, the row must NOT get welded into baseline — otherwise the
  // create's later failure has nothing left in `pending` to revert, and the
  // optimistic row survives forever. This is "no rollback on failed create."
  it('regression: cache-hit read (tainted by mirror) during a pending create does not survive the create failing', () => {
    const sig = makeSignal<string[]>([]);
    const cache = new Map<string, string[]>();
    const subject = new Subject<void>();

    // 1. Create starts: instant paint + mirror writes the OPTIMISTIC row into cache.
    svc.run({
      signal: sig,
      apply: (list) => (list.includes('new-row') ? list : [...list, 'new-row']),
      request: () => subject.asObservable(),
      mirror: (v) => cache.set('salon1', v),
      dedupeKey: 'create-service:salon1:new-row',
    });
    expect(sig()).toEqual(['new-row']);
    expect(cache.get('salon1')).toEqual(['new-row']); // cache is tainted — this is the real-world leak

    // 2. A concurrent load() re-mounts and hits that same tainted cache while
    // the create is still pending (simulates navigating back to the list page).
    const loadToken = svc.beginRead(sig, undefined);
    const accepted = svc.commitRead(sig, cache.get('salon1')!, loadToken, (v) => cache.set('salon1', v));
    expect(accepted).toBe(false); // deferred — must NOT bake the tainted cache into baseline
    expect(sig()).toEqual(['new-row']); // still just the optimistic paint, unchanged

    // 3. The create fails server-side.
    subject.error({ error: {} });

    // 4. The row must be gone — reverted to the true (empty) baseline. Before
    // the fix, the tainted cache-hit in step 2 would have welded 'new-row'
    // into baseline, and this would incorrectly still show ['new-row'].
    expect(sig()).toEqual([]);
  });
});
