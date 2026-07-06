import { Injectable, WritableSignal, DestroyRef, signal, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, finalize } from 'rxjs';
import { ToastService } from '../toast/toast.service';
import { isApiError } from '../errors/api-error.types';

export interface OptimisticConfig<T, R = unknown> {
  signal: WritableSignal<T>; // view state to mutate
  apply: (current: T) => T; // predict — MUST be pure; it is REPLAYED
  request: () => Observable<R>; // the real backend call (typed)
  reconcile?: (current: T, response: R) => T; // fold server truth into baseline (creates/updates)
  mirror?: (value: T) => void; // write-through to the Map cache slice
  contextKey?: string; // scope key (e.g. salonId); context change replaces the ledger
  tempId?: string; // quarantined id for temp rows (creates/uploads)
  // In-flight idempotency key — REQUIRED on every run(). A second run() with
  // the same key while the first is unsettled is DROPPED entirely (no paint,
  // no request). This is what stops a double-tap from producing two rows and
  // two POSTs (creates can't self-guard on isPending — every call mints a
  // fresh tempId). Convention: `${ClassName}.${methodName}:${entityId}` —
  // the class+method pair is unique by construction, so two different
  // operations on the same entity (e.g. update vs deactivate) can never
  // collide with each other, only with themselves. For creates (no existing
  // id yet), key off the payload instead, e.g. `ServicesService.create:${salonId}:${name}`.
  dedupeKey: string;
  errorMessage?: string; // toast ONLY on generic reverted case
  onSuccess?: (response: R) => void; // after confirm (close dialog, navigate)
  onRevert?: () => void; // after revert (e.g. re-open the edit dialog)
  onSettled?: () => void; // fires exactly once on EVERY terminal path (confirm,
  // revert, superseded-confirm, superseded-revert);
  // use for cleanup that must happen regardless (blob revoke)
}

interface PendingOp<T> {
  key: symbol;
  apply: (s: T) => T;
}

interface Ledger<T> {
  baseline: T;                    // last server-confirmed state
  pending: PendingOp<T>[];        // ordered optimistic ops not yet settled
  mirror?: (v: T) => void;        // set on ledger creation or adopted within matching context
  contextKey?: string;            // scope key — a different key triggers ledger replacement
  epoch: number;                  // bumped on every accepted write AND accepted read; guards stale reads
}

/**
 * Read token captured by a service the moment it ISSUES a load(). Handed back
 * to commitRead when the response lands, so the engine can tell a stale read
 * (a write confirmed OR a newer read landed while this GET was in flight) from
 * one that is genuinely the freshest state (apply it as the new baseline).
 * Epochs are globally monotonic (never reused across ledger incarnations), so
 * an epoch match implies same incarnation and therefore same context — no
 * explicit contextKey on the token is needed.
 */
export interface ReadToken {
  readonly epoch: number;
}

@Injectable({ providedIn: 'root' })
export class OptimisticService {
  private readonly _toast = inject(ToastService);
  // WeakMap, not Map: the signal is a weakly-held key, so a destroyed
  // feature-scoped service's ledger dies with its signal — no leak, no root.
  private readonly _ledgers = new WeakMap<WritableSignal<unknown>, Ledger<unknown>>();
  private readonly _pendingIds = signal<ReadonlySet<string>>(new Set());
  // In-flight dedupe keys (see OptimisticConfig.dedupeKey). Plain Set, not a
  // signal — no template reads it; it exists only to reject re-entrant run()s.
  private readonly _inflightKeys = new Set<string>();
  private _epochStamp = 0; // globally monotonic — no epoch is ever reused

  /** Templates/services check this to quarantine temp rows. */
  isPending(id: string): boolean {
    return this._pendingIds().has(id);
  }

  /**
   * Capture the current epoch for a signal BEFORE issuing a load().
   * Pass the returned token to commitRead when the response arrives.
   * beginRead expresses user intent — it MAY create or replace a ledger.
   */
  beginRead<T>(sig: WritableSignal<T>, contextKey?: string): ReadToken {
    return { epoch: this._ledgerFor(sig, undefined, contextKey).epoch };
  }

  /**
   * Wipe an engine-managed signal on logout (or any context teardown).
   * Deletes the ledger — the next `beginRead`/`run` creates a fresh incarnation
   * with a fresh globally-monotonic epoch, so tokens from the previous session
   * can never match. Sets the signal to `value` so it visibly reflects the
   * cleared state.
   *
   * In-flight ops on the deleted ledger will settle through the existing
   * superseded path (`_isSuperseded` returns true when the ledger is gone).
   *
   * MUST replace every `signal.set(emptyValue)` in `clear()` methods — direct
   * `.set()` on an engine-managed signal is the rule #3 violation this fixes.
   */
  reset<T>(sig: WritableSignal<T>, value: T): void {
    this._ledgers.delete(sig as WritableSignal<unknown>);
    sig.set(value);
  }

  /**
   * Returns `true` if the op was accepted (painted + request fired), `false`
   * if dropped by the dedupeKey gate (a re-entrant call while the same key is
   * still in flight). Callers that also mutate a second, manually-kept-in-sync
   * signal (Part 3h's named-exception pattern) MUST gate that companion write
   * on this return value — otherwise a dropped run() still lets the companion
   * mutation through with nothing to ever revert it.
   */
  run<T, R>(config: OptimisticConfig<T, R>, destroyRef?: DestroyRef): boolean {
    // Idempotency gate: a re-entrant run() with a dedupeKey already in flight
    // is dropped entirely — no op, no optimistic paint, no request. This is
    // what stops a double-tapped "Create" from producing two rows + two POSTs
    // (creates can't self-guard on isPending — every call mints a fresh tempId).
    if (this._inflightKeys.has(config.dedupeKey)) return false;
    this._inflightKeys.add(config.dedupeKey);

    const ledger = this._ledgerFor(config.signal, config.mirror, config.contextKey);
    const op: PendingOp<T> = { key: Symbol(), apply: config.apply };
    ledger.pending.push(op);
    if (config.tempId) this._markPending(config.tempId, true);
    this._recompute(config.signal, ledger); // instant paint

    const request$ = config.request();
    // finalize guarantees the dedupe key is freed even if teardown
    // (takeUntilDestroyed) unsubscribes mid-flight, where neither next nor
    // error would fire — otherwise the key would leak in _inflightKeys forever.
    const guarded$ = (destroyRef ? request$.pipe(takeUntilDestroyed(destroyRef)) : request$).pipe(
      finalize(() => this._releaseKey(config.dedupeKey)),
    );

    guarded$.subscribe({
      next: (response) => {
        // CONFIRM
        if (this._isSuperseded(config.signal, ledger)) {
          // Context switched while this op was in flight. The mutation
          // succeeded server-side; the next load() of that context will
          // reflect it. Nothing to do to the current signal.
          this._settleSuperseded(config.tempId, config);
          return;
        }
        // Fold this op into confirmed truth: apply it to baseline, then let
        // the server's response correct/enrich it. Remaining pending ops
        // replay on top in the recompute.
        let base = op.apply(ledger.baseline);
        if (config.reconcile) base = config.reconcile(base, response);
        ledger.baseline = base;
        ledger.epoch = ++this._epochStamp; // a confirmed write happened
        this._settle(config.signal, ledger, op, config.tempId);
        config.onSuccess?.(response);
        config.onSettled?.();
      },
      error: (err) => {
        // REVERT (surgical)
        if (this._isSuperseded(config.signal, ledger)) {
          // Still toast (the user should know it failed) but don't touch the
          // current signal/baseline — it belongs to a newer context now.
          this._settleSuperseded(config.tempId, config, err);
          return;
        }
        // Remove ONLY this op; every other pending op survives the replay.
        // No epoch bump — a failed op changed no confirmed state.
        this._settle(config.signal, ledger, op, config.tempId);
        config.onRevert?.();
        this._toastUnlessKnownError(err, config.errorMessage);
        config.onSettled?.();
      },
    });
    return true;
  }

  /**
   * Services commit ALL reads through this instead of signal.set directly.
   * `token` is what beginRead() returned when the load was issued.
   * Returns `true` if the read was accepted, `false` if dropped (stale OR
   * deferred to a pending op — see below).
   *
   * PEEK-ONLY: commitRead never creates or replaces a ledger. A response
   * arriving is not a user context switch — only `beginRead` and `run`
   * (calls that express user intent) may switch context.
   *
   * Two guards: ledger exists, epoch matches. Epochs are globally monotonic,
   * so an epoch match implies same ledger incarnation and therefore same
   * context — no explicit contextKey comparison needed.
   *
   * A third guard: pending ops in flight. `run()`'s instant-paint recompute
   * calls `mirror()` on the OPTIMISTIC value before the request settles — so
   * a cache a service reads from (e.g. `load()`'s cache-hit path) can itself
   * contain an unconfirmed row while its own create/update op is still
   * pending. If commitRead trusted that value as the new baseline, a later
   * revert would have nothing left in `pending` to undo — the unconfirmed
   * row would get silently welded into confirmed state forever (the "no
   * rollback on failed create" bug). So: while any op is pending on this
   * ledger, the read is deferred — baseline is left untouched, and the
   * eventual confirm/revert's own recompute repaints from the true baseline.
   * The read is not lost forever; once the ledger drains, the next load()
   * (against a by-then-corrected cache) succeeds normally.
   */
  commitRead<T>(
    sig: WritableSignal<T>,
    value: T,
    token: ReadToken,
    mirror?: (v: T) => void,
  ): boolean {
    const ledger = this._ledgers.get(sig as WritableSignal<unknown>) as Ledger<T> | undefined;
    if (!ledger) return false; // no ledger exists — nothing to commit into
    if (ledger.epoch !== token.epoch) return false; // stale — a write, newer read, or context switch raced this
    if (ledger.pending.length > 0) return false; // deferred — see doc comment above
    if (mirror) ledger.mirror = mirror; // adopt mirror within matching context
    ledger.baseline = value;
    ledger.epoch = ++this._epochStamp; // an accepted read IS a baseline write —
    // it must invalidate older in-flight reads too
    this._recompute(sig, ledger);
    return true;
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Free an in-flight dedupe key once its request settles (any terminal path). */
  private _releaseKey(dedupeKey: string | undefined): void {
    if (dedupeKey !== undefined) this._inflightKeys.delete(dedupeKey);
  }

  /** True once a context switch has replaced this op's ledger out from under it. */
  private _isSuperseded<T>(sig: WritableSignal<T>, ledger: Ledger<T>): boolean {
    return this._ledgers.get(sig as WritableSignal<unknown>) !== ledger;
  }

  /**
   * Shared tail for both terminal paths (confirm/revert) once a ledger has
   * been superseded: clear the tempId quarantine, optionally toast on error,
   * and fire onSettled. Never touches the signal — it belongs to a newer
   * context now, and the current ledger already reflects that context.
   */
  private _settleSuperseded<T, R>(
    tempId: string | undefined,
    config: Pick<OptimisticConfig<T, R>, 'onRevert' | 'onSettled' | 'errorMessage'>,
    err?: unknown,
  ): void {
    if (tempId) this._markPending(tempId, false);
    if (err !== undefined) {
      this._toastUnlessKnownError(err, config.errorMessage);
      config.onRevert?.();
    }
    config.onSettled?.();
  }

  /** Suppress our toast when the interceptor already spoke about a known ApiError. */
  private _toastUnlessKnownError(err: unknown, errorMessage?: string): void {
    const body = (err as { error?: unknown })?.error;
    if (!isApiError(body)) {
      this._toast.error(errorMessage ?? 'Something went wrong. Changes reverted.');
    }
  }

  private _ledgerFor<T>(
    sig: WritableSignal<T>,
    mirror?: (v: T) => void,
    contextKey?: string,
  ): Ledger<T> {
    let ledger = this._ledgers.get(sig as WritableSignal<unknown>) as Ledger<T> | undefined;
    if (!ledger || ledger.contextKey !== contextKey) {
      // New signal, OR context changed (e.g. user navigated from salon A to B).
      // Replace the ledger entirely: fresh baseline from the signal's current
      // value, fresh globally-monotonic epoch, new mirror.
      ledger = { baseline: sig(), pending: [], mirror, contextKey, epoch: ++this._epochStamp };
      this._ledgers.set(sig as WritableSignal<unknown>, ledger as Ledger<unknown>);
    } else if (mirror) {
      // Same context — adopt the mirror (covers load-first sequence).
      ledger.mirror = mirror;
    }
    return ledger;
  }

  private _settle<T>(
    sig: WritableSignal<T>,
    ledger: Ledger<T>,
    op: PendingOp<T>,
    tempId?: string,
  ): void {
    ledger.pending = ledger.pending.filter((p) => p.key !== op.key);
    if (tempId) this._markPending(tempId, false);
    this._recompute(sig, ledger);
  }

  private _recompute<T>(sig: WritableSignal<T>, ledger: Ledger<T>): void {
    const next = ledger.pending.reduce((s, p) => p.apply(s), ledger.baseline);
    sig.set(next);
    ledger.mirror?.(next);
  }

  private _markPending(id: string, on: boolean): void {
    this._pendingIds.update((set) => {
      const next = new Set(set);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }
}
