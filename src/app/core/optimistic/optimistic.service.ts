import { Injectable, WritableSignal, DestroyRef, signal, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { ToastService } from '../toast/toast.service';
import { isApiError } from '../errors/api-error.types';

export interface OptimisticConfig<T, R = unknown> {
  signal: WritableSignal<T>;                     // view state to mutate
  apply: (current: T) => T;                      // predict — MUST be pure; it is REPLAYED
  request: () => Observable<R>;                  // the real backend call (typed)
  reconcile?: (current: T, response: R) => T;    // fold server truth into baseline (creates/updates)
  mirror?: (value: T) => void;                   // write-through to the Map cache slice
  contextKey?: string;                           // scope key (e.g. salonId); context change replaces the ledger
  tempId?: string;                               // quarantined id for temp rows (creates/uploads)
  errorMessage?: string;                         // toast ONLY on generic reverted case
  onSuccess?: (response: R) => void;             // after confirm (close dialog, navigate)
  onRevert?: () => void;                         // after revert (e.g. re-open the edit dialog)
  onSettled?: () => void;                        // fires exactly once on EVERY terminal path (confirm,
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
  private _epochStamp = 0;                         // globally monotonic — no epoch is ever reused

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

  run<T, R>(config: OptimisticConfig<T, R>, destroyRef?: DestroyRef): void {
    const ledger = this._ledgerFor(config.signal, config.mirror, config.contextKey);
    const op: PendingOp<T> = { key: Symbol(), apply: config.apply };
    ledger.pending.push(op);
    if (config.tempId) this._markPending(config.tempId, true);
    this._recompute(config.signal, ledger);          // instant paint

    const request$ = config.request();
    const guarded$ = destroyRef
      ? request$.pipe(takeUntilDestroyed(destroyRef))
      : request$;

    guarded$.subscribe({
      next: (response) => {                          // CONFIRM
        // Superseded ledger — context switched while this op was in flight.
        // The mutation succeeded server-side; the next load() of that context
        // will reflect it. Nothing to do to the current signal.
        if (this._ledgers.get(config.signal as WritableSignal<unknown>) !== ledger) {
          if (config.tempId) this._markPending(config.tempId, false);
          config.onSettled?.();
          return;
        }
        // Fold this op into confirmed truth: apply it to baseline, then let
        // the server's response correct/enrich it. Remaining pending ops
        // replay on top in the recompute.
        let base = op.apply(ledger.baseline);
        if (config.reconcile) base = config.reconcile(base, response);
        ledger.baseline = base;
        ledger.epoch = ++this._epochStamp;             // a confirmed write happened
        this._settle(config.signal, ledger, op, config.tempId);
        config.onSuccess?.(response);
        config.onSettled?.();
      },
      error: (err) => {                              // REVERT (surgical)
        // Superseded ledger — still toast (the user should know it failed)
        // but don't touch the current signal/baseline.
        if (this._ledgers.get(config.signal as WritableSignal<unknown>) !== ledger) {
          if (config.tempId) this._markPending(config.tempId, false);
          const body = (err as { error?: unknown })?.error;
          if (!isApiError(body)) {
            this._toast.error(config.errorMessage ?? 'Something went wrong. Changes reverted.');
          }
          config.onRevert?.();
          config.onSettled?.();
          return;
        }
        // Remove ONLY this op; every other pending op survives the replay.
        // No epoch bump — a failed op changed no confirmed state.
        this._settle(config.signal, ledger, op, config.tempId);
        config.onRevert?.();
        // Suppress our toast when the interceptor already spoke about a known
        // ApiError (avoids double-toast). Only speak for network/unknown.
        const body = (err as { error?: unknown })?.error;
        if (!isApiError(body)) {
          this._toast.error(config.errorMessage ?? 'Something went wrong. Changes reverted.');
        }
        config.onSettled?.();
      },
    });
  }

  /**
   * Services commit ALL reads through this instead of signal.set directly.
   * `token` is what beginRead() returned when the load was issued.
   * Returns `true` if the read was accepted, `false` if dropped (stale).
   *
   * PEEK-ONLY: commitRead never creates or replaces a ledger. A response
   * arriving is not a user context switch — only `beginRead` and `run`
   * (calls that express user intent) may switch context.
   *
   * Two guards: ledger exists, epoch matches. Epochs are globally monotonic,
   * so an epoch match implies same ledger incarnation and therefore same
   * context — no explicit contextKey comparison needed.
   */
  commitRead<T>(
    sig: WritableSignal<T>,
    value: T,
    token: ReadToken,
    mirror?: (v: T) => void,
  ): boolean {
    const ledger = this._ledgers.get(sig as WritableSignal<unknown>) as Ledger<T> | undefined;
    if (!ledger) return false;                       // no ledger exists — nothing to commit into
    if (ledger.epoch !== token.epoch) return false;   // stale — a write, newer read, or context switch raced this
    if (mirror) ledger.mirror = mirror;              // adopt mirror within matching context
    ledger.baseline = value;
    ledger.epoch = ++this._epochStamp;                // an accepted read IS a baseline write —
                                                     // it must invalidate older in-flight reads too
    this._recompute(sig, ledger);
    return true;
  }

  // ── internals ──────────────────────────────────────────────────────────

  private _ledgerFor<T>(sig: WritableSignal<T>, mirror?: (v: T) => void, contextKey?: string): Ledger<T> {
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

  private _settle<T>(sig: WritableSignal<T>, ledger: Ledger<T>, op: PendingOp<T>, tempId?: string): void {
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
