# Wait-time math: fix the double-subtraction, extract the duplication

---

## ⚠️ READ FIRST — do these two checks BEFORE writing any fix

Both are falsification checks on this plan's own diagnosis. Neither is
optional, and neither is satisfied by "the code looks right" or by a passing
`tsc`/`ng build`. If either one comes back the wrong way, **stop and report
back — do not proceed to the fix**, because the diagnosis below is then wrong
and implementing it would ship a new bug while appearing to fix the old one.

### Check 1 — write the failing test first, and watch it fail

Before changing a single line of production code, write the four-client
screenshot scenario from Step 1 as a test against **today's** formula
(`Math.max(0, entry.estimatedWaitMinutes - elapsedMinutes)`).

**It must FAIL**, showing the back of the line collapsing toward "< 1m".

If it passes against today's code, the double-subtraction diagnosis is wrong —
the bug is elsewhere, and this plan does not describe it. Stop and say so.

Rationale, stated plainly: twice earlier in this session a fix was called
"verified" on evidence that did not actually cover the claim — once on a
`tsc --noEmit` that did not exercise the failing path, once on a schema field
that may not exist on the wire. This test is the cheap guard against a third.
Seeing red before green is the whole point; do not skip to the fix because the
reasoning reads convincingly.

### Check 2 — confirm the two services actually disagree today

Before the fix, get the barber console and the customer live-queue page onto
the **same queue at the same moment** and compare the waiting clients' numbers.

**They must DISAGREE.** This plan claims the two hand-copied implementations
have already drifted:
- `queue-console.service.ts:481` → `entry.estimatedWaitMinutes + pendingDuration`
- `salon-visit.service.ts:231` → `liveEntryWait + pendingDuration` (elapsed-adjusted)

If they already agree before any change, that drift finding is wrong, the
"extract to remove divergence" justification is weaker than stated, and this
plan needs revisiting before implementation. Stop and report.

After the fix they must agree — same number, same queue, same instant. That is
the visible before/after proving the extraction did what it claims.

---

## The bug (verified against backend source, not inferred)

Four clients on one barber's queue all drift toward "< 1m" while the barber is
still visibly serving client 0. Both the customer live-queue page and the
barber console show it, independently.

**Root cause: the frontend subtracts elapsed time from a backend number that
already has elapsed time subtracted.**

Backend (`backend/src/queues/timeline.service.ts`):
- `remainingDurationOf(entry, now)` (line 137) returns
  `Math.max(0, full - elapsedMin)` for a SERVING entry — elapsed since the
  party's earliest `servedAt` is **already removed**.
- `buildTimeline` (line 488) accumulates that into `accumulatedWaitMinutes`,
  which becomes each waiting entry's `estimatedWaitMinutes`.
- A SERVING entry always reports `estimatedWaitMinutes: 0` for itself
  (line 478), contributing its remaining time only to entries behind it.

Frontend, both copies:
```ts
// salon-visit.service.ts:200  and  queue-console.service.ts:456
map.set(entry.entryId, Math.max(0, entry.estimatedWaitMinutes - elapsedMinutes));
```
`elapsedMinutes` is time since `servedAt` — the *same* quantity the backend
already subtracted. Every waiting entry therefore loses that time twice, in
lockstep, and the whole column collapses toward 0 together. That is exactly
the screenshot.

**Why `memberWaitMinutes` is NOT the cause** (the previous plan's claim):
`pendingDuration` resets to `0` at the top of each entry's member loop, so it
cannot cascade from client 0's entry into client 1's entry. Those are separate
entries. The observed symptom is entry-level, i.e. `liveWaitMinutes`.

**Second, independent defect** — no periodic refresh exists to self-correct.
`backend/src/queues/queue.gateway.ts` emits `queueTimeline` only from
`@OnEvent('queue.updated')` — barber actions. No timer, no heartbeat. So
between actions the client is alone with its own clock, and any error in the
local projection persists until the next barber action. This is why the
overrun case must be handled explicitly rather than waited out.

## The correct model

`estimatedWaitMinutes` is a **projection made at a known instant** —
`serverTime`, which rides every socket frame (`queue.gateway.ts:229-241`) and
every REST timeline response. It is valid *as of* that instant.

So the only honest local extrapolation is: subtract time elapsed **since the
snapshot arrived**, not time since `servedAt`.

```
displayedWait = estimatedWaitMinutes - minutesSince(snapshotServerTime)
```

At the moment a frame lands this is exactly the backend's number (elapsed 0).
It then ticks down in real time. It never double-counts, because
`minutesSince(snapshot)` and the backend's internal elapsed-since-`servedAt`
are disjoint intervals.

**The overrun rule** (the requirement as stated): once the serving member's
elapsed time exceeds their `serviceDuration`, the backend's projection is
built on an assumption that has expired — the barber should have finished and
hasn't. Continuing to tick down would keep promising a turn that isn't coming.
So: **freeze**. Hold the last computed value until a real frame arrives.

Result, which is the stated requirement:
- serving client: 0 / "In Service" (unchanged)
- next in line: reaches "< 1m" and holds — legitimately next
- everyone behind: holds at 30m, 1h, … instead of collapsing

No polling added. Behaviour between frames only.

## Design

New pure module, no Angular DI — both services already own their own clock and
serving-member signals; only the math is shared.

**`src/app/core/queue/wait-time.ts`**

```ts
export interface WaitContext {
  timeline: TimelineEntryDto[];
  /** ms since the snapshot that produced `timeline` was taken (server-time based). */
  sinceSnapshotMs: number;
  /** ms elapsed since the serving party entered the chair, or null if nobody serving. */
  servingElapsedMs: number | null;
  /** Total booked minutes for the serving entry (whole party), or null. */
  servingBookedMinutes: number | null;
}

export function isProjectionStale(ctx: WaitContext): boolean;
export function computeLiveWaitMinutes(ctx: WaitContext): Map<string, number>;
export function computeMemberWaitMinutes(ctx: WaitContext): Map<string, number>;
export function formatWait(minutes: number): string;
```

- `isProjectionStale` — `servingElapsedMs > servingBookedMinutes * 60_000`.
  Mirrors `remainingDurationOf`'s own floor condition.
- `computeLiveWaitMinutes` — `estimatedWaitMinutes - minutesSince(snapshot)`,
  floored at 0; when stale, `sinceSnapshotMs` is clamped to its value at the
  moment staleness began, which is what "freeze" means mechanically.
- `computeMemberWaitMinutes` — same per-entry structure as today, but the
  entry-level term comes from `computeLiveWaitMinutes` (single source), and the
  SERVING member's `pendingDuration` gets `Math.max(0, …)` so an overrun can
  never contribute a negative. This is the previous plan's fix, kept — it is a
  real latent bug, just not the one in the screenshot.
- Uses the **whole entry's** booked duration for the serving party, matching
  `remainingDurationOf`'s "party occupies the chair until its last member is
  done" (`queue-console.service.ts:846-852` already documents this and mirrors
  it deliberately).

### Freeze mechanics

Each service keeps a `_snapshotAt` (server-time ms of the last landed frame)
and a `_frozenSinceMs | null`. On each recompute:
- not stale → `sinceSnapshotMs = clock.now() - _snapshotAt`, `_frozenSince = null`
- newly stale → latch `_frozenSince = clock.now()`
- already stale → `sinceSnapshotMs = _frozenSince - _snapshotAt` (constant)
- any new frame → set `_snapshotAt`, clear `_frozenSince`, resume

Latch lives in each service (it is per-queue mutable state); the pure module
stays a function of its inputs and is trivially testable.

## Steps

**1 — `wait-time.ts` + `wait-time.spec.ts`.** Write tests first; they are the
only place the regression is directly expressible.
Cases: fresh frame reproduces backend numbers exactly; normal tick-down; the
four-client screenshot scenario at t+0/+10/+30/+60min asserting the back of the
line does **not** reach "< 1m"; overrun freeze; frame-after-overrun resumes;
multi-member entry with an overrunning serving member; empty/no-serving.
*Verify:* `ng test` — new suite green, and the screenshot case fails against
today's formula (confirm the test actually catches the bug before fixing it).

**2 — `SalonVisitService`.** Add `_snapshotAt`/`_frozenSince`, set on every
`timeline.set(...)` landing point (socket subscription, and all three in
`_loadInitialTimeline`) alongside the existing `_clock.sync(serverTime)`.
Replace `liveWaitMinutes`/`memberWaitMinutes` bodies with calls into the module.
`formatWait` delegates. `_servingMember`, `_elapsedSeconds`, `waitingEntries`,
`backOfLineWait` unchanged.
*Verify:* `ng build`; live-queue page numbers match backend on frame arrival.

**3 — `QueueConsoleService`.** Same, keeping `_tick`, `displayServingMember`
(optimistic-paint logic, console-only — must not move), `ringProgress`,
`timerFromServedAt`, `estimatedFinishTime`, `_optimisticBaselineWaitMinutes`,
`_entryRemainingMinutes` untouched. This also removes the existing drift: the
console's `entry.estimatedWaitMinutes + pendingDuration`
(`queue-console.service.ts:481`) vs. the customer's `liveEntryWait + …` — after
this both come from one function.
*Verify:* `ng build`; console and customer page show the same number for the
same queue at the same time (they currently do not — this is a checkable
before/after).

**4 — Optimistic-paint consistency.** `_optimisticBaselineWaitMinutes` and
`_entryRemainingMinutes` duplicate backend semantics for temp entries. Confirm
they still agree with the new display math so a staff-added client doesn't
visibly jump when the real frame lands. Change only if they disagree.
*Verify:* add a client from the console, watch for a jump on confirmation.

**5 — Full pass.** `tsc --noEmit`, `ng build`, `ng test`.
*Verify:* 84/85 (pre-existing `app.spec.ts` scaffold failure only).

## Manual verification (the part that actually proves it)

1. Queue with 1 serving + 3 waiting. Note all four numbers on **both** screens.
2. Let it run past the serving client's `serviceDuration` **without** any
   barber action — the exact state in the screenshots.
3. Assert: back of the line holds at its real wait; only next-in-line is
   "< 1m"; the two screens agree throughout.
4. Barber ends session → both resume from fresh backend numbers.
5. Cross-check one number against `GET /queues/:id/timeline` directly.

## Risks

- **Freeze can under-report.** If the barber is genuinely nearly done when the
  overrun starts, waits are held slightly high until the next action. Correct
  trade: over-promising "< 1m" is the reported bug; under-promising is safe.
- **`serverTime` must be captured at every landing point.** Miss one and that
  path anchors to a stale `_snapshotAt` and reads too low. Step 2 enumerates
  all four; the socket path already calls `_clock.sync` at each, so they are
  easy to co-locate.
- **Backend contract is the dependency.** The whole fix rests on
  `estimatedWaitMinutes` being elapsed-adjusted at `serverTime`
  (`timeline.service.ts:137,488`). If that ever changes, `wait-time.ts`'s
  header comment must be updated with it — noted in the file.
- **Out of scope:** the `timeline`-is-one-global-signal FIXME
  (`salon-visit.service.ts:99-112`). Untouched.
