import { TestBed } from '@angular/core/testing';
import { DestroyRef, signal } from '@angular/core';
import { of, throwError, Subject } from 'rxjs';
import { vi } from 'vitest';
import { SocketPredictService } from './socket-predict.service';

describe('SocketPredictService', () => {
  let svc: SocketPredictService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SocketPredictService] });
    svc = TestBed.inject(SocketPredictService);
  });

  // 1. Basic predict-then-settle (no dedupeKey)
  it('paints the signal instantly via apply', () => {
    const sig = signal<string[]>([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'row'], request: () => of(null) });
    expect(sig()).toEqual(['row']);
  });

  it('calls onSuccess when request resolves', () => {
    const sig = signal<string[]>([]);
    const onSuccess = vi.fn();
    svc.run({ signal: sig, apply: (list) => [...list, 'row'], request: () => of('response'), onSuccess });
    expect(onSuccess).toHaveBeenCalledWith('response');
  });

  it('calls onError when request errors', () => {
    const sig = signal<string[]>([]);
    const onError = vi.fn();
    svc.run({ signal: sig, apply: (list) => [...list, 'row'], request: () => throwError(() => new Error('fail')), onError });
    expect(onError).toHaveBeenCalled();
  });

  it('calls onSettled on success', () => {
    const sig = signal<number>(0);
    let settled = 0;
    svc.run({ signal: sig, apply: (n) => n + 1, request: () => of(null), onSettled: () => settled++ });
    expect(settled).toBe(1);
  });

  it('calls onSettled on error', () => {
    const sig = signal<number>(0);
    let settled = 0;
    svc.run({ signal: sig, apply: (n) => n + 1, request: () => throwError(() => new Error('fail')), onSettled: () => settled++ });
    expect(settled).toBe(1);
  });

  it('returns true when accepted', () => {
    const sig = signal<string[]>([]);
    const result = svc.run({ signal: sig, apply: (list) => [...list, 'x'], request: () => of(null) });
    expect(result).toBe(true);
  });

  // 2. dedupeKey — the double-tap fix for staffAddToQueue (Part 7.8a)
  // A double-tapped "Add to queue" must produce exactly one paint and one POST,
  // not two entries and two server requests.
  it('dedupeKey: double-tap → one paint, one POST', () => {
    const sig = signal<string[]>([]);
    const subject = new Subject<void>();
    let requestCount = 0;
    const request = () => { requestCount++; return subject.asObservable(); };

    const first = svc.run({ signal: sig, apply: (list) => [...list, 'entry'], request, dedupeKey: 'QueueConsoleService.staffAddToQueue:q1:Alice' });
    expect(first).toBe(true);
    expect(sig()).toEqual(['entry']);
    expect(requestCount).toBe(1);

    // Second tap while first is still in flight — must be a complete no-op.
    const second = svc.run({ signal: sig, apply: (list) => [...list, 'entry'], request, dedupeKey: 'QueueConsoleService.staffAddToQueue:q1:Alice' });
    expect(second).toBe(false);
    expect(sig()).toEqual(['entry']); // NOT ['entry', 'entry']
    expect(requestCount).toBe(1);   // NOT 2
  });

  it('dedupeKey: releases after request completes — next call with same key runs', () => {
    const sig = signal<string[]>([]);
    const result1 = svc.run({ signal: sig, apply: (list) => [...list, 'a'], request: () => of(null), dedupeKey: 'k' });
    expect(result1).toBe(true);
    // First request already settled synchronously (of(null)) — key freed.
    const result2 = svc.run({ signal: sig, apply: (list) => [...list, 'b'], request: () => of(null), dedupeKey: 'k' });
    expect(result2).toBe(true);
    expect(sig()).toEqual(['a', 'b']);
  });

  it('dedupeKey: releases after request errors', () => {
    const sig = signal<string[]>([]);
    svc.run({ signal: sig, apply: (list) => [...list, 'x'], request: () => throwError(() => new Error('fail')), dedupeKey: 'k' });
    const result = svc.run({ signal: sig, apply: (list) => [...list, 'y'], request: () => of(null), dedupeKey: 'k' });
    expect(result).toBe(true);
    expect(sig()).toContain('y');
  });

  it('dedupeKey: releases on teardown even if neither next nor error fires', () => {
    const sig = signal<string[]>([]);
    const subject = new Subject<void>();
    let destroyCallback: (() => void) | undefined;
    const destroyRef = {
      onDestroy: (cb: () => void) => { destroyCallback = cb; return () => {}; },
      destroyed: false,
    } as unknown as DestroyRef;

    svc.run({ signal: sig, apply: (list) => [...list, 'row'], request: () => subject.asObservable(), dedupeKey: 'k', destroyRef });
    destroyCallback?.(); // simulate component destruction

    let requestCount = 0;
    const result = svc.run({ signal: sig, apply: (list) => [...list, 'row2'], request: () => { requestCount++; return of(null); }, dedupeKey: 'k' });
    expect(result).toBe(true);
    expect(requestCount).toBe(1);
  });

  it('dedupeKey: different keys never block each other', () => {
    const sig = signal<string[]>([]);
    const s1 = new Subject<void>();
    const s2 = new Subject<void>();
    const r1 = svc.run({ signal: sig, apply: (list) => [...list, 'a'], request: () => s1.asObservable(), dedupeKey: 'key-a' });
    const r2 = svc.run({ signal: sig, apply: (list) => [...list, 'b'], request: () => s2.asObservable(), dedupeKey: 'key-b' });
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(sig()).toEqual(['a', 'b']);
  });

  it('no dedupeKey: multiple calls all paint and fire', () => {
    const sig = signal<string[]>([]);
    let count = 0;
    svc.run({ signal: sig, apply: (list) => [...list, 'x'], request: () => { count++; return of(null); } });
    svc.run({ signal: sig, apply: (list) => [...list, 'x'], request: () => { count++; return of(null); } });
    expect(count).toBe(2);
    expect(sig()).toEqual(['x', 'x']);
  });
});
