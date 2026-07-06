# optimistic.md — Optimistic Updates Framework (v2)

**Status: built and shipped** (commits `3623bf4`, `ea1968c`, `f45c023`, `12f30ad`). This document is now both the design record and the reference for extending the pattern to any future mutation — read Part 6 for what landed where, and Part 3f–3h for the conventions and named exceptions that emerged during the actual migration and weren't part of the original design.

## Purpose

Before this framework, every mutation in the app waited for the server round-trip before the UI changed: `acting.set(true)` → request → `refresh()` (a second round-trip) → paint. The app felt sluggish because the network latency was visible on every action.

This framework makes predictable mutations paint instantly, fire the request in the background, and roll back + toast on failure. Truth comes from the mutation's own response (reconcile), not a second GET.

Excluded entirely: auth, billing/subscriptions.

Built in RxJS throughout — the generated client is Observable-native, the whole codebase ties in-flight requests to `takeUntilDestroyed(DestroyRef)`, and CLAUDE.md forbids raw Promises in data methods. No `firstValueFrom` in the engine — a Promise gives no teardown, so a request outliving a destroyed feature-scoped service would `signal.set` into a dead context.

## What changed from v1 (and why)

1. **Snapshot-revert replaced by an operation ledger.** v1's `signal.set(before)` had a concurrency hole: op A snapshots, op B applies on top, A fails → A's revert wipes B's optimistic state even if B later succeeds. Two quick deletes where the first fails would resurrect *both* rows visually until B confirmed — or worse, drop B's change permanently if B had no reconcile. The engine now keeps a per-signal ledger (`baseline` = last server-confirmed state, `pending` = ordered ops) and **recomputes** the signal on every settle instead of restoring a snapshot. Reverting A removes only A's op; B's apply survives the replay.
2. **`CachePatch` deleted, replaced by `mirror`.** The Map cache slice exists to mirror the view signal — so instead of patching signal and cache independently (v1's triple-method interface, with its own snapshot-clobber problem), the engine writes the recomputed signal value through to the cache after every change. One source of truth; ghosts become impossible by construction.
3. **Read-vs-write AND read-vs-read races handled via `beginRead`/`commitRead` + a monotonic epoch.** v1 said nothing about a `load()` already in flight when an optimistic apply lands — the stale GET would resolve and stomp the optimistic state. Services now commit reads through the engine, which stamps a monotonic epoch on every accepted write *and every accepted read*: a read whose captured epoch still matches becomes the new `baseline`; a read whose epoch was moved by a confirmed write *or a newer read that already landed* is dropped. This closes the whole staleness family — write-clobbers-write, read-clobbers-write, and read-clobbers-read (two overlapping loads landing out of order). Fresh state always wins; stale state — from any source — can never overwrite it. **(Superseded by point 9 below: an epoch match alone is no longer sufficient — a read is also deferred outright while any op is pending on that ledger, not composed with it.)**
4. **`run<T, R>` is generic over the response.** `reconcile: (current: T, response: R) => T` — no more `as { body: Service }` casts at every call site. The generated client is typed; the engine now preserves that.
5. **Temp-id quarantine specified now, not deferred.** The engine tracks pending ids; services guard, templates disable. Mechanism below.
6. **The ledger is `WeakMap`-keyed and carries a monotonic epoch bumped by every accepted write and read.** Two holes the first ledger draft left open, both closed structurally rather than by discipline:
   - *Leak:* a `Map<WritableSignal, Ledger>` makes the signal a GC root — a feature-scoped service destroyed mid-flight would pin a dead signal forever. `WeakMap` keys are weakly held, so the ledger dies with the signal.
   - *Stale-response races:* if the ledger were dropped once `pending` empties (the naive GC), a `load()` resolving *after* the last op confirmed would find no ledger and `set()` stale server data — resurrecting a just-confirmed delete. So the ledger is retained (bounded by the `WeakMap`), and every *accepted* write and read stamps the monotonic `epoch`. `beginRead` captures the epoch when the GET is *issued*; `commitRead` drops the result if the epoch has since moved — whether by a confirmed write or by a newer read that already landed. Freshest state always wins; a stale response (from either vector) is discarded, not applied.
7. **Ledgers are context-keyed, not just signal-keyed.** Many services reuse a single signal as a "slot" whose meaning changes when the user navigates (e.g. `ServicesService._services` holds the *current* salon's list; a `Map` cache is keyed per salon). The ledger is keyed by signal object, so it outlives any single context. Without a context key, navigating from salon A to salon B means: the mirror still closes over A's salonId (first-caller-wins), every recompute writes B's data into A's cache slice; and any pending op from A replays its `apply` on B's baseline, appending phantom rows. Both failures are deterministic on the second salon a user opens — not a race, corruption.

   The fix: `run` and `beginRead` carry an optional `contextKey` (the salonId for multi-salon services, omitted or a constant for single-entity services like OrgService). When `_ledgerFor` sees a key that differs from the current ledger's, it **replaces** the ledger — fresh baseline from `sig()`, a fresh globally-monotonic epoch, new mirror — and every settle path first checks `this._ledgers.get(sig) === ledger`; a superseded ledger's ops settle silently (the mutation succeeded or failed server-side, but its context is gone; the next `load()` of that salon will reflect reality). `commitRead` is **peek-only**: it checks only that a ledger exists and the token's epoch matches. Epochs are globally monotonic (never reused across incarnations), so an epoch match *implies* same incarnation and therefore same context — no explicit `contextKey` on the token is needed. This closes the ABA problem: a token from incarnation 1 can never collide with incarnation 2's epoch. This gives "superseded" a defined meaning and strengthens the two-writer invariant (rule #3): a signal's writers are `run` and `commitRead` *within the current context*; a context switch is a clean break, not a mutation.
8. **`dedupeKey` — required in-flight idempotency key on every `run()`.** Discovered in production: a double-tapped "Create" (slow render, or a genuinely fast second tap before navigation fired) called `create()` twice before the first settled. Each call minted its own `tempId` and appended its own row — creates have no existing entity id to guard on the way `update`/`deactivate` do via `isPending`, so nothing stopped it. Fix: `run()` now takes a **required** `dedupeKey`. A second `run()` with a key already in `_inflightKeys` is dropped entirely — no paint, no request. The key releases on every terminal path via `finalize()` (confirm, revert, *and* teardown if `destroyRef` unsubscribes mid-flight — otherwise it would leak forever). Convention: `` `${ClassName}.${methodName}:${entityId}` `` for id-based ops (class+method pair is unique by construction, so `update` and `deactivate` on the same entity can never collide with *each other*, only with themselves); for creates, key off the payload instead (e.g. `` `ServicesService.create:${salonId}:${name}` ``).
9. **`commitRead` now defers to pending ops instead of composing with them.** This closed a second production bug in the same family, found while fixing the first: `run()`'s instant-paint calls `mirror()` on the *optimistic* value before the request settles — so a service's own Map cache can transiently hold an unconfirmed row. If a concurrent `load()` did a cache-hit read while that create was still pending, the old contract (§3/§6 above: an accepted read becomes baseline, pending ops replay on top) let that tainted cache value get welded straight into `baseline`. When the create then failed, there was nothing left in `pending` for `_settle` to remove — the unconfirmed row survived the revert permanently ("no rollback on failed create"). The epoch mechanism didn't catch this because it protects against a *stale* read landing late relative to *another* read or write; it was never designed to detect a *fresh* read that happens to already contain a not-yet-confirmed sibling op's effect. Fix: `commitRead` checks `ledger.pending.length > 0` and defers (returns `false`, `baseline` untouched) whenever *any* op is still in flight on that signal — regardless of whether the read is a cache-hit or a genuine network response. The read isn't lost: once the pending op settles (confirm folds it into baseline properly via `reconcile`, or revert discards it), the *next* `load()` sees a clean cache and commits normally. This supersedes the "read composes with pending op" behavior described in point 3 and demonstrated in Part 2's original example — composing was exactly the mechanism that let an unconfirmed value leak into confirmed state.

## Part 1 — The Two Categories

### Category A — Predictable → the optimistic engine

You can compute the resulting state from the inputs alone.

| Service | Methods |
|---|---|
| SalonOverviewService | `toggleAcceptingClients` (also fixes the current backwards impl — it waits for success before flipping) |
| ServicesService | `create`, `update`, `deactivate`, `assignService`, `removeService`, `setDefaultService` |
| ClosuresService | `createSalon`, `createStaff`, `deleteSalon`, `deleteStaff` |
| SchedulesService | `create`, `update`, `remove` |
| StaffService | `cancelInvite`, `updateRole`, `remove` |
| OrgService | `update` (rename) |
| SalonMediaService / StaffMediaService | `delete`, `reorder`, `upload` (blob-preview reconcile) |
| InvitesService | `accept`, `decline` (already list-splice; migrate onto engine) |
| FavoritesService | `toggle` (already optimistic; migrate for one consistent path) |
| New SalonSettingsService | settings + slug edits (moved out of components — decision #4) |

### Category B — Non-predictable → NOT the engine

The server computes something you can't fake.

| Flow | Treatment |
|---|---|
| Join queue | Navigation-is-feedback (Part 5) — navigate to position page instantly, socket fills in position |
| Queue console (call-next / serve / complete / no-show / cancel / extend) | Leave socket-driven; timeline recomputes server-side, arrives over the socket |
| Billing (checkout / verify / upgrade / downgrade / cancel) | Server-confirmed; spinner is honest |
| Salon create / delete | Navigation + destructive; spinner is honest |
| All auth | Excluded by decision |

## Part 2 — The Engine (RxJS, ledger-based)

Location: `src/app/core/optimistic/optimistic.service.ts`

Mental model: **baseline + pending ops → recompute.** The signal's rendered value is always `pending.reduce(apply, baseline)`. Confirm folds an op into the baseline (via its reconcile); revert removes the op; either way the signal is recomputed from what remains. There is no "restore snapshot" anywhere — restoration is a *consequence* of replay, which is why concurrent ops can't clobber each other.

The machinery is identical for every mutation; only `apply` (the prediction) differs. That's why it's one engine, not 15 copies.

```ts
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

  run<T, R>(config: OptimisticConfig<T, R>, destroyRef?: DestroyRef): void {
    // Idempotency gate: a re-entrant run() with a dedupeKey already in flight
    // is dropped entirely — no op, no optimistic paint, no request. This is
    // what stops a double-tapped "Create" from producing two rows + two POSTs
    // (creates can't self-guard on isPending — every call mints a fresh tempId).
    if (this._inflightKeys.has(config.dedupeKey)) return;
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
```

### Engine properties

- **Concurrent ops can't clobber each other.** Two overlapping deletes: A fails, B in flight → recompute = baseline + B's apply. Only A's row comes back. This was the v1 flaw; it's structurally impossible now.
- **`apply` is replayed, so it must be pure.** No side effects, no reading external mutable state. Side effects belong in `reconcile`, `onSuccess`, `onRevert` (each fires **at most once** — superseded ops skip them entirely). `onSettled` is the only **exactly-once** hook; must-run cleanup goes there, success-only effects go in `onSuccess`. This is the discipline the ledger buys its safety with — it goes in code review checklists.
- **Out-of-order confirms are accepted.** If B's response lands before A's, B folds into baseline first and A replays on top; for non-commutative edits to the *same* item this can transiently differ from wall-clock order until both settle. This is the last-write-wins decision (#7), now stated precisely: it applies to *ordering*, not to *survival* — no op ever destroys another's state.
- **The `acting` guard disappears.** Buttons stay live; each action is an independent bet.
- **No `refresh()` after success.** Deleting that second round-trip is the whole point. Truth comes from `reconcile` (the mutation's own response), not a fresh GET.
- **One mirror per signal per context.** The mirror is set when the ledger is created — a context switch recreates the ledger with the new mirror. Within a matching context, any caller that supplies a mirror sets it (`if (mirror) ledger.mirror = mirror`), which covers the common load-first sequence: `beginRead` creates the ledger with no mirror, then `run` or `commitRead` supplies one. Safe because same `contextKey` means the closures capture the same salonId; "latest wins within a context" is well-defined where "first wins across contexts" wasn't.
- **Ledgers are `WeakMap`-keyed and outlive `pending`.** The ledger is *not* deleted when `pending` empties. Retention is defense-in-depth, not load-bearing: with globally-monotonic epochs, a missing ledger already causes `commitRead` to return `false`, and a recreated one would get a fresh epoch that can't match any old token. Keeping it avoids needless delete-then-recreate churn on the common load-after-settle path. Retention is bounded structurally: the `WeakMap` holds the signal weakly, so when the signal itself is collected (its owning service destroyed and unreferenced) the ledger goes with it. Nothing pins a dead signal.
- **Stale reads are dropped, not applied — against writes *and* other reads.** `commitRead` compares the read's captured `epoch` against the ledger's current one, and bumps the epoch when it accepts. So a read is discarded if, while its GET was in flight, either a write confirmed (delete-then-late-GET can't resurrect the row), a newer read already landed (two overlapping loads can't settle out of order), *or* a context switch replaced the ledger (globally-monotonic epoch guarantees no collision). An accepted read is itself a baseline write; treating it as one is what closes read-vs-read.
- **Reads are deferred, not composed, while any op is pending.** `commitRead` also checks `ledger.pending.length > 0` and returns `false` if so — *even when the epoch matches*. This closed a real production bug: `run()`'s instant-paint calls `mirror()` on the optimistic value before the request settles, so a service's own Map cache can transiently hold an unconfirmed row. A concurrent `load()` hitting that cache while the op was still pending used to have its read *compose* with the pending op (epoch matched, so `commitRead` accepted it and replayed `pending` on top) — but the read value *itself* already contained the unconfirmed row, baked into what became the new `baseline`. When the op then failed, there was nothing left in `pending` for `_settle` to remove — the row survived the revert permanently ("no rollback on failed create"). Deferring instead of composing closes it: `baseline` stays untouched until the pending op settles for real (via its own confirm/revert), and only then does the *next* `load()` (against a by-then-correct cache) get to commit.
- **`destroyRef` is optional.** Root singletons (most services) never destroy → omit it. A feature-scoped service (e.g. QueueConsoleService) passes its `_destroyRef`. If teardown cancels a request mid-flight, neither `next` nor `error` fires — the op lingers in the ledger, but the ledger is keyed weakly by a now-unreferenced signal, so both are reclaimed together. No leak.
- **Context switch replaces the ledger; superseded ops settle silently.** When `_ledgerFor` sees a `contextKey` that differs from the current ledger's, it replaces the ledger entirely — fresh baseline, a fresh globally-monotonic epoch (never 0, never reused), new mirror. In-flight ops from the old context check `this._ledgers.get(sig) === ledger` on settle: a superseded ledger's success drops silently (the mutation landed server-side; the next `load()` of that context will show it); a superseded error still toasts (the user should know it failed) but does not touch the signal or baseline. Single-entity services (OrgService) omit `contextKey` or pass a constant — no replacement ever triggers. **Assumption:** when `beginRead(B)` creates the new ledger, its baseline seeds from `sig()`, which still holds A's data until the read commits. Services must clear the signal or show a skeleton on navigation so state is visibly "loading" rather than stale; the engine does not enforce this.
- **`commitRead` is peek-only — it never creates or replaces a ledger.** A response arriving is not a user context switch. Only `beginRead` and `run` — calls that express user intent — may create or replace a ledger. `commitRead` looks up the existing ledger via `_ledgers.get()` and checks only that the token's epoch matches. Epochs are globally monotonic, so an epoch match implies same ledger incarnation and same context — no explicit `contextKey` comparison on the token is needed. This closes both the A→B ping-pong (context switch bumps epoch) and the A→B→A ABA problem (reborn ledger gets a fresh epoch that can never collide with a token from the previous incarnation).

### Temp-id quarantine (specified, not deferred)

A `temp_` row must never send its fake id to the server. Two layers:

1. **UI:** templates disable row actions via `optimistic.isPending(row.id)` (expose the engine or a service passthrough). Pending gallery tiles already render dimmed + spinner.
2. **Service backstop:** any engine-migrated method that *receives* an id starts with:

```ts
if (this._optimistic.isPending(serviceId)) return;   // quarantined until reconcile swaps the real id
```

The engine adds/removes ids from `_pendingIds` automatically when `tempId` is set in the config — no per-service bookkeeping.

### Read commits (the load() rule)

Every service `load()` that writes an engine-managed signal goes through `commitRead`. Capture the read token with `beginRead` *before* issuing the request, and hand it back on arrival:

```ts
load(salonId: string): void {
  const token = this._optimistic.beginRead(this._services, salonId);   // capture epoch
  servicesControllerList(this._http, this._apiConfig.rootUrl, { salonId }).subscribe((res) => {
    this._optimistic.commitRead(this._services, res.body, token, (v) => this._cache.set(salonId, v));
  });
}
```

Five outcomes, all correct:
- **No write or newer read landed while the GET was in flight, AND no op is pending** → the read is the freshest truth: it becomes the new baseline. Nothing left in `pending` to replay on top, so the signal is simply the fresh read.
- **An op is still pending on this ledger** (epoch matches, but `pending.length > 0`) → the read is **deferred**, not composed. `baseline` is left untouched; the pending op's own confirm/revert settles the signal instead. This is the fix for the "no rollback on failed create" bug: composing a read that itself contains an unconfirmed row (leaked in via `mirror` during instant-paint) used to weld that row into confirmed state before the op could ever fail and revert it.
- **A write confirmed mid-flight** (epoch moved) → the read is stale relative to confirmed state and is **dropped**. This is the case a late GET after a confirmed delete would otherwise lose to — resurrecting the deleted row.
- **A newer read landed first** (epoch moved by a prior `commitRead`) → this read is stale relative to the newer server data and is **dropped**. Two overlapping loads can't settle out of order — the epoch-on-read bump is what closes read-vs-read.
- **Context switched** (epoch moved because the context switch created a new ledger with a fresh globally-monotonic epoch) → the read belongs to a context the user has navigated away from and is **dropped**. `commitRead` is peek-only — it never creates or replaces a ledger. The globally-monotonic epoch also closes the ABA variant: navigating A→B→A creates a reborn ledger whose epoch can never match a token from the original incarnation.

## Part 3 — Migration examples (the real shapes)

### 3a. Delete (no reconcile) — `ServicesService.deactivate`

```ts
deactivate(salonId: string, serviceId: string, onSuccess?: () => void): void {
  if (this._optimistic.isPending(serviceId)) return;           // temp-row backstop
  this._optimistic.run({
    signal: this._services,
    apply: (list) => list.filter((s) => s.id !== serviceId),
    mirror: (v) => this._cache.set(salonId, v),
    contextKey: salonId,
    request: () => servicesControllerDeactivate(this._http, this._apiConfig.rootUrl, { salonId, serviceId }),
    errorMessage: 'Could not remove service. Restored.',
    onSuccess,
  });
}
```

### 3b. Toggle — `SalonOverviewService.toggleAcceptingClients` (fixes the backwards one)

```ts
toggleAcceptingClients(salonId: string, staffId: string): void {
  const next = !this._myStaff()?.isAcceptingClients;
  this._optimistic.run({
    signal: this._myStaff,
    apply: (s) => (s ? { ...s, isAcceptingClients: next } : s),
    mirror: (v) => {
      const entry = this._cache.get(salonId);
      if (entry) this._cache.set(salonId, { ...entry, myStaff: v });
    },
    contextKey: salonId,
    request: () => staffControllerToggleAcceptingClients(this._http, this._apiConfig.rootUrl, {
      salonId, staffId, body: { isAcceptingClients: next },
    }),
    errorMessage: 'Failed to update status. Reverted.',
  });
}
```

(Note: the v1 open question about `SalonOverviewCache.myStaff` needing a one-off `CachePatch` shape evaporates — a mirror is just a function, so object-shaped caches are the same three lines as list-shaped ones.)

### 3c. Create with temp-id + typed reconcile — `ServicesService.create`

Append a `temp_` row instantly; swap in the server's real entity on success so the row's edit/delete actions get the real id. Note `reconcile` is now typed against the generated client's response — no casts. Two details that are load-bearing, both found in production after the naive version shipped:

- **`apply` must be idempotent** (`list.some(tempId) ? list : append`), not a blind append. `apply` is *replayed* on every recompute, including a deferred read draining (Part 2's "reads are deferred, not composed" property) — a non-idempotent `apply` would duplicate the row on replay. This is what caused the double-entry bug in production.
- **`dedupeKey` is required** and must be derived from the payload (no existing entity id yet to key on, unlike `update`/`deactivate`, which key on `serviceId` via `isPending`). This is what stops a double-tap from firing `create()` twice before the first settles.

```ts
create(salonId: string, body: CreateServiceDto, onSuccess?: () => void): void {
  const tempId = `temp_${crypto.randomUUID()}`;
  const optimisticRow = { id: tempId, ...body } as Service;
  this._optimistic.run({
    signal: this._services,
    apply: (list) => (list.some((s) => s.id === tempId) ? list : [...list, optimisticRow]),
    reconcile: (list, res) => list.map((s) => (s.id === tempId ? res.body : s)),
    tempId,                                                    // engine quarantines it
    dedupeKey: `ServicesService.create:${salonId}:${body.name}`,
    mirror: (v) => this._cache.set(salonId, v),
    contextKey: salonId,
    request: () => servicesControllerCreate(this._http, this._apiConfig.rootUrl, { salonId, body }),
    errorMessage: 'Could not create service. Reverted.',
    onSuccess,
  });
}
```

### 3d. Media upload — blob preview + reconcile

The reference case for "placeholder that swaps for the real entity." Show the picked file instantly via a local blob URL; upload in background; swap the blob tile for the real Cloudinary Media on success, drop it + toast on failure. Blob URLs are revoked in `onSettled` — the one hook that fires exactly once on every terminal path (confirm, revert, superseded-confirm, superseded-revert). Revoking in `reconcile` or `onRevert` would miss the superseded paths; revoking in `apply` is unsafe because `apply` replays.

```ts
upload(salonId: string, file: File, onSuccess?: () => void): void {
  const tempId = `temp_${crypto.randomUUID()}`;
  const blobUrl = URL.createObjectURL(file);
  const optimisticTile = { id: tempId, url: blobUrl, pending: true } as Media & { pending?: boolean };
  this._optimistic.run({
    signal: this._media,
    // idempotent — apply is replayed (e.g. a deferred read draining), a blind
    // append would duplicate the tile on replay
    apply: (list) => (list.some((m) => m.id === tempId) ? list : [...list, optimisticTile]),
    reconcile: (list, res) => {
      return list.map((m) => (m.id === tempId ? res.body : m));
    },
    tempId,
    dedupeKey: `SalonMediaService.upload:${salonId}:${file.name}:${file.size}:${file.lastModified}`,
    mirror: (v) => this._cache.set(salonId, v),
    contextKey: salonId,
    request: () => mediaControllerUpload(this._http, this._apiConfig.rootUrl, {
      body: { file, entityType: 'SALON', entityId: salonId, type: 'GALLERY' },
    }),
    errorMessage: 'Upload failed. Removed.',
    onSuccess,
    onSettled: () => URL.revokeObjectURL(blobUrl),             // fires exactly once — all paths
  });
}
```

The gallery template renders pending tiles dimmed with a spinner; `pending` is a view-only augment on the temp tile and never touches the real Media model. Tile actions are disabled via `isPending`.

### 3e. Settings/slug — `SalonSettingsService` (shipped)

Extracted per decision #4 — `salon-settings.component.ts` / `salon-slug.component.ts` no longer touch `HttpClient` or the generated client directly. `SalonSettingsService` (`providedIn: 'root'`, registered with `CacheRegistry`) holds the `salon` signal + Map cache and runs `update`/`updateSlug` through the engine. Two real-world details the earlier plan didn't anticipate:

- **A single mutation can be two API calls.** `update()` needs both `salonsControllerUpdate` (name/timezone/hours) and `salonsControllerUpdateSettings` (the settings JSON) to apply as one optimistic bet — `request: () => forkJoin({ salon: ..., settings: ... })`, `reconcile: (_, { salon }) => salon.body`. The engine doesn't care how many HTTP calls `request()` makes; it only cares that it's one `Observable` that settles once.
- **Wrapping `request()` with `catchError` to intercept one error code before the engine's generic revert.** `updateSlug()` needs `SALON_SLUG_TAKEN` handled as an inline form error, not the engine's generic toast-and-revert. Rather than adding a slug-specific branch to the engine, the request itself is piped through `catchError` to fire `onSlugTaken?.()` and then re-throw — the engine still reverts and (since the interceptor already toasted the known `ApiError`) stays silent. This is the general pattern for any migrated mutation that needs one specific error code handled locally: wrap `request()`, don't fork the engine.

### 3f. Conventions every migrated `load()` follows (not in v1, now standard)

Every service migrated onto the engine (`ServicesService`, `StaffService`, `SalonMediaService`, `StaffMediaService`, `OrgService`, `SalonSettingsService`) converged on the same three additions around `beginRead`/`commitRead` that the original engine design didn't specify, because they're service-level hygiene, not engine-internal:

1. **An `_inflight` guard** (`Set<string>` keyed by context, or a single `string | null` for single-entity services like `OrgService`) — prevents a second `load()` for the same context from firing a duplicate GET while one is already in flight. This is orthogonal to the epoch (which handles *ordering* once two GETs exist); the guard's job is not to create the second GET at all when the cache is empty and a fetch is already running.
2. **`.pipe(retry(1))`** on every `_fetch*` GET — one automatic retry before surfacing an error, since a transient network blip shouldn't cost the user a manual reload.
3. **An `error` signal** (`readonly error = this._error.asReadonly()`) alongside `loading`, set on the terminal failure path so list views can render a real error state instead of silently staying empty.

The canonical shape:

```ts
load(salonId: string): void {
  const token = this._optimistic.beginRead(this._services, salonId);
  const cached = this._cache.get(salonId);
  if (cached) {
    this._optimistic.commitRead(this._services, cached, token, (v) => this._cache.set(salonId, v));
    return;
  }
  if (this._inflight.has(salonId)) return;              // duplicate-fetch guard
  this._fetchServices(salonId, token);
}

private _fetchServices(salonId: string, token: ReadToken): void {
  this._inflight.add(salonId);
  this._loading.set(true);
  this._error.set(false);
  publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, { salonId })
    .pipe(retry(1))
    .subscribe({
      next: (res) => {
        this._inflight.delete(salonId);
        this._cache.set(salonId, res.body);
        this._optimistic.commitRead(this._services, res.body, token, (v) => this._cache.set(salonId, v));
        this._loading.set(false);
      },
      error: () => { this._inflight.delete(salonId); this._error.set(true); this._loading.set(false); },
    });
}
```

### 3g. `patchMedia` — folding an already-completed API call through the ledger

`SalonMediaService` added an escape hatch not in the original engine design: a way to apply a local patch to an engine-managed signal *without* the engine making its own API call, for when the real API call already happened somewhere else (a child component that owns its own upload flow) and the parent just needs its cache-mirrored signal updated in step.

```ts
/** Apply a client-side patch without an API call (API already completed in a child component). */
patchMedia(salonId: string, updater: (list: Media[]) => Media[]): void {
  this._optimistic.run({
    signal: this._media,
    apply: updater,
    mirror: (v) => this._cache.set(salonId, v),
    contextKey: salonId,
    request: () => of(null),               // no-op request — there's nothing left to confirm
  });
}
```

This works because the engine has no special case for "no real request" — `of(null)` is a valid `Observable` that emits synchronously, so the patch instant-paints and is confirmed into the baseline in the same tick, through the exact same ledger machinery as every other mutation. Use this only when the server-side effect is already guaranteed to have happened (or is being tracked elsewhere); it is not a way to skip error handling for a real mutation.

### 3h. Two deliberate non-migrations — named exceptions, not gaps

**`FavoritesService._list`** stays outside the engine even though `_favoritedIds` (the `Set<string>` of favorited ids) is migrated. `_list` is the favourites-page's own paginated card data — a *different* signal from `_favoritedIds`, not a cache slice of the same one, so it's not what `mirror` is for. `toggle()` splices `_list` by hand before calling `run()`, and un-splices it by hand in `onRevert`. This is correct: `mirror` exists to keep one signal's Map-cache in sync with itself, not to propagate a change across two independently-shaped signals. If a future case needs to keep two *unrelated* signals in lockstep under one optimistic bet, this is the pattern — inline patch plus a matching manual undo in `onRevert`, not a engine feature.

**`EditProfileService.update()`** is hand-rolled snapshot-revert (`const prev = user(); set(predicted); on error: set(prev)`) and does **not** use the engine. This is the exact v1 pattern the engine was built to replace everywhere else — but it's a deliberate, narrow exception, not a missed migration: `CurrentUserStore.user` is a single global signal with exactly one writer path (the profile form), no per-context concerns (`contextKey` would be meaningless — there's only ever one "current user"), and no realistic concurrent-mutation risk (a user cannot submit the profile form twice at once in any reasonable UI). Snapshot-revert's actual failure mode — a second concurrent op's state getting clobbered by the first op's revert — cannot occur here because there is only ever at most one in-flight profile edit. If profile editing ever grows a second concurrent mutation path (e.g. avatar upload racing a name change on the same signal), this should move onto the engine at that point, not before.

## Part 4 — Category B: Join Queue (navigation-is-feedback)

Different mechanism — documented here so the two never get confused. You can't optimistically fake a queue position (server-assigned). You can make it feel instant:

1. On tap, navigate to the position page immediately, request in flight.
2. Position page shows a real pending state: "Finding your spot…" skeleton — not a fake number.
3. POST returns `{ entryId, guestToken }` → store ActiveEntry → socket `queueTimeline$` delivers the real position → skeleton resolves.
4. On failure (`QUEUE_NOT_OPEN`, network): toast + navigate back to the salon page. The "rollback" for a navigation is undoing the route, not a signal.

Honest: the user sees motion instantly; the only thing that waits is the number, which nobody can know until the server speaks. This is a routing pattern, not the OptimisticService engine. Keep them separate in code and in your head.

The full design for this — plus the console's call-next button, a second non-engine case — is Part 4a below.

## Part 4a — Call-Next (local-predict, socket-reconciled) + Join-Queue (navigation-is-feedback, detailed)

Two more non-engine patterns, each a deliberate exception to a documented rule, worked out in full because each has a real failure mode that a naive version gets wrong.

### 4a.1 — Call-Next (and the whole console): optimistic, but NOT the engine

**Why not the engine, precisely:** Category B (queue console) stays socket-driven because most console actions recompute the *whole* timeline server-side and another operator could act concurrently — optimistically reordering the full queue risks showing a state that's flatly wrong. Call-next is the console action where the local prediction is smallest and almost-always-correct: the head `WAITING` entry becomes `SERVING`. That's a single-entry status flip, not a full-timeline guess.

**Shipped broader than planned: `SocketPredictService` (`core/socket/socket-predict.service.ts`).** The original plan scoped this pattern to call-next alone, leaving every other console action on the plain `acting`-guard/wait-for-socket path. In the actual build, the predict→fire→socket-reconciles-or-refetch shape turned out to generalize cleanly to *every* console mutation — `setStatus`, `callNext`, `endSession`/`completeMember`, `endAllMembers`, `noShow`, `cancelEntry`, `serveMember`, `extendMember`, `staffAddToQueue` — so it was extracted into its own root-provided service rather than repeated inline nine times:

```ts
@Injectable({ providedIn: 'root' })
export class SocketPredictService {
  run<T, R = unknown>(config: {
    signal: WritableSignal<T>;
    apply: (current: T) => T;
    request: () => Observable<R>;
    onSuccess?: (response: R) => void;
    onError?: (error: unknown) => void;
    destroyRef?: DestroyRef;
  }): void {
    config.signal.update((v) => config.apply(v));          // 1. predict — paint instantly
    const req$ = config.destroyRef
      ? config.request().pipe(takeUntilDestroyed(config.destroyRef))
      : config.request();
    req$.subscribe({                                       // 2. fire
      next: (res) => config.onSuccess?.(res),               // socket delivers truth; often a no-op here
      error: (err) => config.onError?.(err),                // 3. caller decides how to revert
    });
  }
}
```

This is deliberately **thinner than `OptimisticService`** — no ledger, no epoch, no `contextKey`, no `tempId` quarantine — because there is nothing to reconcile against on success (the socket does that) and no concurrent-read problem to solve (there's no `load()`/`commitRead` for a live timeline; the socket subscription is the only writer of confirmed state). It is a shared *shape*, not a shared *safety mechanism* — each call site still owns its own revert logic in `onError`, because "what does reverting mean" differs per action (see below).

**The flagship example, `QueueConsoleService.callNext()`** (queue-console.service.ts:178–219):

```ts
callNext(salonId, queueId, onResolveNeeded): void {
  const waiting = this.waitingEntries();
  if (waiting.length === 0) return;
  const head = waiting[0];
  this._socketPredict.run({
    signal: this.timeline,
    apply: (t) => t.map((e) => e.entryId !== head.entryId ? e : {
      ...e, members: e.members.map((m) =>
        m.isLeader && m.status === 'WAITING'
          ? { ...m, status: 'SERVING', servedAt: new Date().toISOString() } : m),
    }),
    request: () => queueManagementControllerCallNext(this._http, this._apiConfig.rootUrl, { salonId, queueId }),
    onError: (err) => {
      this._refetchTimeline(queueId);                       // REVERT = re-assert authority, never hand-undo
      const body = (err as { error?: unknown })?.error;
      if (isApiError(body) && (body.code === ErrorCodes.ENTRY_ALREADY_SERVING || body.code === ErrorCodes.ENTRY_NOT_WAITING)) {
        onResolveNeeded();
      } else {
        this._toast.info('Resolve the current client first before calling the next one.');
      }
    },
    destroyRef: this._destroyRef,
  });
}
```

**Why the revert re-fetches instead of restoring a snapshot:** the socket may push a new timeline between `apply` painting and the error landing. Restoring a captured snapshot would stomp that newer socket state — the exact `read-current-to-undo` bug the whole `OptimisticService` ledger (Part 2) was built to eliminate. On failure the server changed nothing, so its authoritative timeline is already correct; `_refetchTimeline` (the same GET `init()` uses) pulls it and the overlay vanishes cleanly. **The socket is authority — the revert comes from authority, not from a hand-merge.** Every other console action's `onError` follows the identical `_refetchTimeline(queueId)` idiom — it's the one revert strategy that's always correct for socket-owned state, so there was no reason to hand-roll a different one per action.

**Concurrency:** the `acting` guard was removed from every action migrated onto `SocketPredictService` (not just call-next, as originally scoped) — each is an independent bet, and a failure's refetch corrects whatever the prediction got wrong regardless of how many other predictions landed on top of it in the meantime. A double-tap's second `callNext` POST 409s (`ENTRY_ALREADY_SERVING`) → `onResolveNeeded()` fires → correct.

**Does NOT change:** the socket subscription (still the sole source of confirmed truth), the `OptimisticService` engine (this is explicitly a separate, thinner mechanism for a different problem shape).

### 4a.2 — Join-Queue: navigation-is-feedback, with the two failure modes pinned down

The mechanism (navigate instantly, let the socket fill in the position) is right, but two things make or break it in practice — both closed here, not left as follow-up.

**Crux #1 — result delivery must survive either arrival order.** Navigation and the POST response are now decoupled: the POST can resolve *before* the lazy-loaded joining page finishes mounting and subscribing. A plain `Subject` drops that emission — the page hangs on "Finding your spot…" forever. Fix: a **signal**, not a Subject, so the component reads current state on init regardless of timing (a signal read-on-mount can't miss what already happened; a Subject can).

```ts
// SalonVisitService — shipped as-designed (types kept exactly as planned, one refinement:
// 'party-too-large' split out from 'generic' so the joining page can show the specific toast)
export type PendingJoin =
  | { status: 'pending' }
  | { status: 'joined'; entryId: string; queueId: string; slug: string; shellPrefix: string }
  | { status: 'failed'; reason: 'closed' | 'party-too-large' | 'generic' };

readonly pendingJoin = signal<PendingJoin | null>(null);
```

`confirmJoin` sets `pending` and navigates to `/joining`. `joinQueue`'s existing `next`/`error` handlers set `joined`/`failed` (keeping the existing ActiveEntry save + guest-token capture on success). `JoiningQueueComponent` reads `pendingJoin()` in a constructor effect — fires on mount *and* on every change, so a result landed before mount is picked up immediately.

**Crux #2 — not every failure should let the user leave the page.** Split by whether the failure is knowable before confirming or only from the server:

- **Block BEFORE navigation** (no bounce): frozen salon and already-in-queue (`frozen()`, `alreadyInQueue()` in `join-queue.component.ts`) — both checkable at confirm time. `confirmJoin` returns early, never navigates.
- **Bounce AFTER navigation** (genuinely server-only): `QUEUE_NOT_OPEN` (queue closed between page-load and confirm) → `reason: 'closed'`, `PARTY_TOO_LARGE` (server-enforced cap) → `reason: 'party-too-large'`, network/generic → `reason: 'generic'`. `pendingJoin → failed(reason)`; the joining page navigates back to the salon page + the reason's specific toast.

This keeps predictable failures on the form (no flash) and only bounces for the rare, unknowable-until-server ones. **Bonus, unplanned:** `leaveQueue()` was also migrated onto `SocketPredictService` (Part 4a.1) — predict the entry's removal from `timeline`, fire the DELETE, and on failure re-add the `ActiveEntry` + refetch the timeline. Not in the original plan, but the same reasoning applies: `timeline` is socket-owned state, so it gets the socket-reconciled pattern rather than the ledger.

**File-by-file:**
1. **visit.routes.ts** (after the `join` route): add `q/:queueId/joining` → lazy-loads `JoiningQueueComponent`. Needs no `entryId` param — which is why guests work (their `guestToken` only exists post-response).
2. **New `joining-queue/joining-queue.component.ts` + `.html`:** skeleton "Finding your spot…" (reuse the position page's circle for visual continuity). Constructor effect on `pendingJoin()`: `joined` → `router.navigate([...base,'q',queueId,'e',entryId,'position'], { replaceUrl: true })`; `failed` → navigate back to salon + toast. Clears `pendingJoin` after handling.
3. **salon-visit.service.ts `joinQueue()`:** keep the POST, ActiveEntry save, guest-token capture, `_loadInitialTimeline`; replace the `onSuccess` callback contract with setting `pendingJoin`.
4. **join-queue.component.ts `confirmJoin`/`_submitJoin`:** after closing the dialog, guard (frozen/alreadyInQueue → return), then set `pendingJoin` to `pending` + navigate to `/joining`, then call `visit.joinQueue(...)`. The old success-navigation block is deleted — that's the joining page's job now.

**Does NOT change:** `MyPositionComponent` (reads `entryId` from the route + socket timeline — works untouched once the real URL exists), the socket subscription, ActiveEntry storage, the guest-token flow (completes inside the joining→position handoff), and the rejoin path (`selectBarber` still routes existing entries straight to position — `/joining` is fresh-join only).

**Accepted residual:** on success there's a brief window where the joining page has handed off to `/e/:entryId/position` but that page's own socket timeline hasn't arrived yet, so the position page shows its own short skeleton. Two skeletons in sequence on a slow connection, not one continuous one. Correct and honest (we genuinely don't have the position yet) — accepted rather than fixed, since unifying them would couple the joining page to the position page's timeline just to shave one transition.

## Part 5 — The hard rules (what makes this safe)

1. **`apply` is pure and replayable.** It runs multiple times (every recompute). No side effects, no ambient reads. Side effects live in `reconcile` / `onSuccess` / `onRevert`, which fire **at most once** (superseded ops skip them). `onSettled` is the only **exactly-once** hook — must-run cleanup goes there; success-only effects go in `onSuccess`. This is the #1 code-review check for every migration.
2. **Revert is removal, never restoration.** Failed ops are removed from the ledger and the signal recomputes from `baseline` + surviving ops. There is no snapshot to restore — concurrent ops cannot clobber each other by construction.
3. **An engine-managed signal has exactly two writers: `run` and `commitRead`.** Nothing else may call `.set`/`.update` on it — not a cache-hit fast path, not a filter reset, not a socket handler added later. A stray direct write diverges the signal from `ledger.baseline`, and the next recompute silently snaps the UI back to the stale baseline — a failure that reads as "the engine randomly undid my change," nastier than any race. This is greppable: for every signal the engine manages, the only `.set` sites in the codebase should be inside `OptimisticService`. Reads therefore always go through `beginRead` + `commitRead` (capture the token before issuing the GET) — a `load()` that calls `signal.set` directly is exactly the violation this rule forbids.
4. **Signal and cache move together via `mirror`.** The cache is write-through from the signal, never patched independently. Miss the mirror → a ghost reappears on the next load. Mirror is set on ledger creation; a context switch recreates the ledger with the new mirror. Within a matching context, a late-arriving mirror is adopted (`if (mirror) ledger.mirror = mirror`) — this covers the common load-first sequence where `beginRead` creates the ledger and `commitRead` or `run` supplies the mirror later.
5. **No double-toast.** Engine stays silent when the error is a known `ApiError` (interceptor already toasted); it speaks only for network/unknown, via `errorMessage`.
6. **Reconcile only when the server enriches.** Deletes/toggles: none. Creates/updates/uploads: reconcile from the mutation's own typed response, never a separate GET.
7. **Temp ids are quarantined by the engine.** Pass `tempId` in the config; check `isPending(id)` in templates (disable) and at the top of service methods (backstop). A fake id must never reach the server.
8. **Blob URLs are revoked in `onSettled`.** The hook fires exactly once on every terminal path — confirm, revert, superseded-confirm, superseded-revert — so no path can leak.
9. **Concurrency = last-write-wins on ordering, not survival.** Overlapping edits to the same item may settle in response order rather than wall-clock order (accepted for single-user salon editing). No operation ever destroys another's state. Revisit with per-entity serialization only if overlapping same-item edits become real — not now (YAGNI).
10. **Teardown via `takeUntilDestroyed`.** Root services omit `destroyRef`; feature-scoped services pass theirs so an in-flight request can't settle into a destroyed context.

## Part 6 — Build order

**Status: shipped.** All ten steps below are implemented and in the codebase (commits `3623bf4`, `ea1968c`, `f45c023`, `12f30ad`, plus the unreleased `dedupeKey` + deferred-read fixes described in changelog points 8–9). Kept as a build order for reference and for anyone extending the pattern to a new service — each step's rationale still applies to future migrations. The tests in step 1 run under Vitest (`optimistic.service.spec.ts`), not Karma — 27 tests as of the latest fix.

1. **OptimisticService engine (ledger) + `beginRead`/`commitRead` + quarantine.** Unit tests, in order of what they protect:
   - apply → reject → signal recomputed without the op, `onRevert` fired (basic revert);
   - **two overlapping ops, first rejects, second confirms → second's state survives throughout** (the v1 clobber case — this test is the reason v2 exists);
   - **read while an op is pending is DEFERRED, not composed** — `commitRead` returns `false` and `baseline` stays untouched; when the op later fails it reverts cleanly to the TRUE baseline, not the deferred read's value (supersedes the old "read composes with pending op" test — composing was the mechanism that let an unconfirmed row leak into confirmed state, see changelog point 9);
   - **`beginRead` → op confirms (epoch bumps) → that read's `commitRead` lands late → read DROPPED, confirmed state intact** (read-clobbers-write — a delete-then-late-GET must not resurrect the row);
   - **two `beginRead` tokens → the second commits first (accepted, epoch bumps) → the first commits late → first DROPPED, newer read's data intact** (read-clobbers-read — the last hole the epoch-on-read bump closes; without the bump the older response would win);
   - `tempId` present in `isPending` during flight, absent after both settle paths;
   - mirror called with the recomputed value on every transition;
   - **`_ledgers` is a `WeakMap`** — a structural assertion (the store's type, and that `run`'s subscription is the only transient strong ref, released by `takeUntilDestroyed`). Not a behavioral GC test: forcing collection needs `FinalizationRegistry` + `--expose-gc` and is nondeterministic under any runner (Vitest included) — a flaky GC probe must never gate the suite;
   - **context switch → mirror follows new context** — run with contextKey A, switch to B, run with B → mirror writes to B's cache slice, not A's. The old ledger is replaced; the new one starts with a fresh baseline from `sig()`;
   - **old-context pending op settles without touching new context** — run with contextKey A (op pending), switch to B (ledger replaced), A's op confirms → signal unchanged, B's cache untouched, no recompute. Error path still toasts;
   - `commitRead` returns `true` when accepted, `false` when dropped (stale epoch OR deferred to a pending op);
   - **A→B→A ping-pong: late B read dropped, A's view intact** — `beginRead(B)` replaces ledger (context B), user navigates back to A → `beginRead(A)` replaces ledger (context A), B's response lands → `commitRead` peeks, finds token epoch ≠ ledger epoch (globally monotonic) → dropped, signal still shows A's data. The ping-pong proof;
   - **ABA epoch-reuse: old read from incarnation 1 can't match incarnation 2** — `beginRead(A)` (slow read₁ in flight, token captures epoch N) → delete confirms (epoch stamps to N+1) → `beginRead(B)` (ledger replaced, epoch N+2) → `beginRead(A)` (ledger reborn, epoch N+3) → read₁'s `commitRead` lands with epoch N → N ≠ N+3 → **dropped**, `false` returned, deleted row stays gone. Without the global epoch stamp this test fails (reborn ledger would start at 0 and match the old token). The ABA proof;
   - **load-first mirror adoption** — `beginRead(B)` creates ledger with no mirror, `commitRead(B)` supplies mirror → mirror adopted within matching context, subsequent mutation via `run(B)` mirrors to B's cache slice. Proves Bug 2 fix;
   - **`onSettled` fires exactly once on all four terminal paths** — confirm, revert, superseded-confirm, superseded-revert. Verify with a counter incremented in `onSettled`; assert count === 1 after each settle;
   - **`dedupeKey`: re-entrant `run()` with a key already in flight is dropped** — no second paint, no second request; releases on confirm, on revert, on different keys never blocking each other, and on teardown even when neither `next` nor `error` fires (a stubbed `DestroyRef` that captures and manually invokes the `onDestroy` callback, since `takeUntilDestroyed` only tears down when destroy genuinely fires);
   - **Regression: cache-hit read tainted by `mirror` during a pending create does not survive the create failing** — the exact real-world sequence (create paints + mirrors the optimistic row into a fake Map cache → concurrent `load()` does a cache-hit `commitRead` while the create is still pending → create fails) asserted end-to-end: the deferred read never lands, and the signal reverts to `[]`, not the tainted cached value. This is the test that would have caught "no rollback on failed create" before it shipped.
2. **`toggleAcceptingClients`** — fixes a bug and demos the pattern (clearest win). ✅ `SalonOverviewService.toggleAcceptingClients`.
3. **Migrate every `load()` in engine-adjacent services to `commitRead`** — must land before the mutation migrations widen, or read races reappear service by service. ✅ Every migrated service's `load()`/`refresh()` goes through `beginRead`/`commitRead`, converged on the shared conventions in Part 3f (`_inflight` guard, `retry(1)`, `error` signal).
4. **Deletes/toggles across services** (no reconcile — lowest risk). ✅ `ServicesService`, `StaffService`, `ClosuresService`, `SchedulesService`, `SalonMediaService`/`StaffMediaService`.
5. **Updates + creates** (temp-id + reconcile). ✅ Including the two-request-in-one-op case (`SalonSettingsService.update`, Part 3e) and the invite-list temp-row case (`StaffService.invite`, `InvitesService`).
6. **Media upload** (blob preview — highest complexity; do it once the pattern is proven). ✅ `SalonMediaService.upload` / `StaffMediaService.upload`, using `onSettled` for the blob-URL revoke.
7. **Extract `SalonSettingsService`;** migrate settings/slug off the components. ✅ Also picked up the `catchError`-wrapped-request pattern for `SALON_SLUG_TAKEN` (Part 3e).
8. **Call-next optimistic** (Part 4a.1) — self-contained in `QueueConsoleService` + one template binding; no new files; ships independently of the engine migration. ✅ Generalized further than planned: extracted as a reusable `SocketPredictService` (Part 4a.1) and applied to every console action (call-next, serve, complete-member, complete-all, no-show, cancel, extend, staff-add-to-queue), not just call-next.
9. **Join-queue navigation-is-feedback** (Part 4a.2) — new route + `JoiningQueueComponent` + `SalonVisitService.pendingJoin` + `JoinQueueComponent` changes; ships independently of the engine migration. ✅ Built to the documented design (signal-based `PendingJoin`, block-before/bounce-after error split); `leaveQueue` also picked up `SocketPredictService` (Part 4a.1) as a bonus, unplanned but consistent with the pattern.
10. **Delete the orphaned code** — the `acting`/`refresh()`-after-mutate paths the migration makes dead. ✅ No leftover `refresh()`-after-`run()` calls remain in the migrated services.

**Named, deliberate exceptions (not gaps — see Part 3h):** `FavoritesService._list` (a second signal kept in sync by hand, not via `mirror`) and `EditProfileService.update` (single-writer signal, snapshot-revert is safe here because no concurrent mutation path exists).

No open design questions remain deferred: the myStaff cache shape is solved by `mirror` being an arbitrary function (3b), temp-row quarantining is engine-owned (Part 2), and the signal-identity-vs-entity-identity problem is solved by `contextKey` (change #7). As of commit `12f30ad`, the plan and the codebase agree: every Category A service is on the engine, both Category B exceptions (console + join-queue) are built, and the only signals *not* on the engine are the two named exceptions in Part 3h, each with a stated reason that will stop applying only if its stated precondition changes.
