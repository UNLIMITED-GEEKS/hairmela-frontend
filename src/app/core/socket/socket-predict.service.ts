import { Injectable, WritableSignal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

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
  /**
   * Predict a signal's next state, fire an HTTP mutation, and handle the result.
   * The signal is updated immediately via `apply`; the socket is expected to
   * overwrite it with authoritative state within ~200ms. On HTTP error,
   * `onError` is called to refetch/revert.
   */
  run<T, R = unknown>(config: {
    signal: WritableSignal<T>;
    apply: (current: T) => T;
    request: () => Observable<R>;
    onSuccess?: (response: R) => void;
    onError?: (error: unknown) => void;
    destroyRef?: DestroyRef;
  }): void {
    // 1. Predict — paint instantly
    config.signal.update((v) => config.apply(v));

    // 2. Fire — socket delivers truth; caller refetches on error
    const req$ = config.destroyRef
      ? config.request().pipe(takeUntilDestroyed(config.destroyRef))
      : config.request();

    req$.subscribe({
      next: (res) => config.onSuccess?.(res),
      error: (err) => config.onError?.(err),
    });
  }
}
