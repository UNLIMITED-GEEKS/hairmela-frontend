import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
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
      errorMessage: 'oops', onRevert,
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
    svc.run({ signal: sig, apply: (list) => [...list, 'A'], request: () => subjectA.asObservable() });
    expect(sig()).toEqual(['A']);
    svc.run({ signal: sig, apply: (list) => [...list, 'B'], request: () => subjectB.asObservable() });
    expect(sig()).toEqual(['A', 'B']);
    subjectA.error({ error: {} });
    expect(sig()).toEqual(['B']);
    subjectB.next(); subjectB.complete();
    expect(sig()).toEqual(['B']);
  });

  // 3. Read composes with pending op
  it('commitRead: server data becomes baseline, pending op replays on top', () => {
    const sig = makeSignal<string[]>([]);
    const subject = new Subject<void>();
    const token = svc.beginRead(sig);
    svc.run({ signal: sig, apply: (list) => [...list, 'optimistic'], request: () => subject.asObservable() });
    expect(sig()).toEqual(['optimistic']);
    svc.commitRead(sig, ['server'], token);
    expect(sig()).toEqual(['server', 'optimistic']);
    subject.next(); subject.complete();
    expect(sig()).toEqual(['server', 'optimistic']);
  });

  // 4. Read-clobbers-write
  it('late GET after confirmed delete is dropped — deleted row does not resurrect', () => {
    const sig = makeSignal<string[]>(['initial']);
    const token = svc.beginRead(sig);
    svc.run({ signal: sig, apply: (list) => list.filter((x) => x !== 'initial'), request: () => of(null) });
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
    svc.run({ signal: sig, apply: (list) => [...list, 'temp_123'], request: () => subject.asObservable(), tempId: 'temp_123' });
    expect(svc.isPending('temp_123')).toBe(true);
    subject.next(); subject.complete();
    expect(svc.isPending('temp_123')).toBe(false);
  });

  // 6b. tempId: gone after revert
  it('isPending false after revert', () => {
    const sig = makeSignal<string[]>([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'temp_456'], request: () => throwError(() => ({ error: {} })), tempId: 'temp_456' });
    expect(svc.isPending('temp_456')).toBe(false);
  });

  // 7a. mirror called on apply and confirm
  it('mirror called on apply; last call after confirm has confirmed value', () => {
    const sig = makeSignal<number[]>([]);
    const mirror = vi.fn();
    const subject = new Subject<void>();
    svc.run({ signal: sig, apply: (list) => [...list, 1], request: () => subject.asObservable(), mirror });
    expect(mirror).toHaveBeenCalledWith([1]);
    subject.next(); subject.complete();
    expect(mirror).toHaveBeenLastCalledWith([1]);
  });

  // 7b. mirror reverts to baseline
  it('mirror receives baseline value after revert', () => {
    const sig = makeSignal<number[]>([10]);
    const mirror = vi.fn();
    svc.run({ signal: sig, apply: (list) => [...list, 99], request: () => throwError(() => ({ error: {} })), mirror });
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
    svc.run({ signal: sig, apply: (list) => [...list, 'a'], request: () => of(null), mirror: mirrorA, contextKey: 'A' });
    expect(mirrorA).toHaveBeenCalled();
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'b'], request: () => of(null), mirror: mirrorB, contextKey: 'B' });
    expect(mirrorB).toHaveBeenCalled();
    const lastB = mirrorB.mock.calls[mirrorB.mock.calls.length - 1][0] as string[];
    expect(lastB).toContain('b');
  });

  // 10a. Old-context op confirms — does not touch new context
  it('superseded op (A) confirms after switch to B — signal unchanged', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>();
    svc.run({ signal: sig, apply: (list) => [...list, 'from-A'], request: () => subjectA.asObservable(), contextKey: 'A' });
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'from-B'], request: () => of(null), contextKey: 'B' });
    const afterB = sig();
    subjectA.next(); subjectA.complete();
    expect(sig()).toEqual(afterB);
  });

  // 10b. Old-context op errors — toasts but does not touch signal
  it('superseded op (A) errors — toasts, does not touch signal', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>();
    svc.run({ signal: sig, apply: (list) => [...list, 'from-A'], request: () => subjectA.asObservable(), contextKey: 'A', errorMessage: 'A failed' });
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'from-B'], request: () => of(null), contextKey: 'B' });
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
    svc.run({ signal: sig, apply: (list) => list.filter((x) => x !== 'initial'), request: () => of(null) });
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
    svc.run({ signal: sig, apply: (list) => [...list, 'op'], request: () => of(null), contextKey: 'salon1' });
    expect(mirror).toHaveBeenCalled();
  });

  // 15. onSettled fires exactly once — all four terminal paths
  it('onSettled fires exactly once on confirm', () => {
    const sig = makeSignal<number[]>([]); let count = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 1], request: () => of(null), onSettled: () => count++ });
    expect(count).toBe(1);
  });

  it('onSettled fires exactly once on revert', () => {
    const sig = makeSignal<number[]>([]); let count = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 1], request: () => throwError(() => ({ error: {} })), onSettled: () => count++ });
    expect(count).toBe(1);
  });

  it('onSettled fires exactly once on superseded-confirm', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>(); let count = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 'A'], request: () => subjectA.asObservable(), contextKey: 'A', onSettled: () => count++ });
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'B'], request: () => of(null), contextKey: 'B' });
    subjectA.next(); subjectA.complete();
    expect(count).toBe(1);
  });

  it('onSettled fires exactly once on superseded-revert', () => {
    const sig = makeSignal<string[]>([]);
    const subjectA = new Subject<void>(); let count = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 'A'], request: () => subjectA.asObservable(), contextKey: 'A', onSettled: () => count++ });
    sig.set([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'B'], request: () => of(null), contextKey: 'B' });
    subjectA.error({ error: {} });
    expect(count).toBe(1);
  });
});
