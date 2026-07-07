import { Injectable, WritableSignal, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Observable } from 'rxjs';
import { ToastService } from '../toast/toast.service';

/**
 * Shared service for socket-driven optimistic mutations.
 *
 * Pattern: predict the signal instantly → fire HTTP in background →
 * socket delivers authoritative state on success; onError refetches on failure.
 *
 * NOT the OptimisticService engine — this is for signals where a socket
 * subscription is the source of truth (queue timelines), not a ledger.
 */
@Injectable({ providedIn: 'root' })
export class SocketPredictService {
  private readonly _toast = inject(ToastService);

  // In-flight dedupe keys (optional — see config.dedupeKey). Same shape as
  // OptimisticService._inflightKeys: a re-entrant run() with a key already in
  // flight is dropped entirely (no paint, no request), which is what stops a
  // double-tapped action from firing two predictions + two HTTP calls when
  // there is no existing entity id to guard on (e.g. staffAddToQueue).
  private readonly _inflightKeys = new Set<string>();

  /**
   * Predict a signal's next state, fire an HTTP mutation, and handle the result.
   * The signal is updated immediately via `apply`; the socket is expected to
   * overwrite it with authoritative state within ~200ms. On HTTP error,
   * `onError` is called to refetch/revert.
   *
   * Returns `true` if the op was accepted (painted + request fired), `false`
   * if dropped by the optional `dedupeKey` gate (a re-entrant call while the
   * same key is still in flight).
   */
  run<T, R = unknown>(config: {
    signal: WritableSignal<T>;
    apply: (current: T) => T;
    request: () => Observable<R>;
    onSuccess?: (response: R) => void;
    onError?: (error: unknown) => void;
    onSettled?: () => void;
    destroyRef?: DestroyRef;
    dedupeKey?: string;
    // Id(s) this op acts on. If any of them is still a temp_-prefixed row (the
    // socket hasn't yet replaced it with the real server-assigned id), the op
    // is rejected outright — no paint, no request — with a toast explaining
    // why. Replaces the old pattern of every call site hand-rolling
    // `if (entryId.startsWith('temp_')) return;` with no feedback to the user.
    targetIds?: string[];
  }): boolean {
    if (config.targetIds?.some((id) => id.startsWith('temp_'))) {
      this._toast.error('Still saving — try again in a moment.');
      return false;
    }

    if (config.dedupeKey !== undefined && this._inflightKeys.has(config.dedupeKey)) return false;
    if (config.dedupeKey !== undefined) this._inflightKeys.add(config.dedupeKey);

    // 1. Predict — paint instantly
    config.signal.update((v) => config.apply(v));

    // 2. Fire — socket delivers truth; caller refetches on error
    const request$ = config.request();
    const guarded$ = (
      config.destroyRef ? request$.pipe(takeUntilDestroyed(config.destroyRef)) : request$
    ).pipe(
      finalize(() => {
        this._releaseKey(config.dedupeKey);
        config.onSettled?.();
      }),
    );

    guarded$.subscribe({
      next: (res) => config.onSuccess?.(res),
      error: (err) => config.onError?.(err),
    });
    return true;
  }

  /** Free an in-flight dedupe key once its request settles (any terminal path). */
  private _releaseKey(dedupeKey: string | undefined): void {
    if (dedupeKey !== undefined) this._inflightKeys.delete(dedupeKey);
  }
}
