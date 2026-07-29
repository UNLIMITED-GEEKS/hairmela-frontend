import { TimelineEntryDto } from '../socket/socket.types';

// Shared wait-time projection, used by both SalonVisitService (customer
// live-queue page) and QueueConsoleService (barber console) — previously two
// independently hand-copied, already-drifted implementations of the same math
// (see wait-time-extraction.md for the full incident writeup).
//
// THE DEPENDENCY THIS FILE RESTS ON: the backend's estimatedWaitMinutes is a
// projection computed AS OF serverTime, with elapsed-since-servedAt for any
// SERVING entry already subtracted (backend/src/queues/timeline.service.ts —
// remainingDurationOf, accumulated into buildTimeline's accumulatedWaitMinutes).
// A SERVING entry always reports estimatedWaitMinutes: 0 for itself.
//
// Given that, the only honest local extrapolation between socket frames is to
// subtract time elapsed SINCE THE SNAPSHOT ARRIVED (sinceSnapshotMs below) —
// NOT time elapsed since servedAt again, which would double-subtract the same
// interval the backend already removed. If the backend's contract here ever
// changes, this file's math must change with it.
export interface WaitContext {
  timeline: TimelineEntryDto[];
  // ms of the snapshot's age that counts toward the countdown. Callers get
  // this from effectiveSinceSnapshotMs(), which holds it constant once the
  // serving party overruns its booking.
  sinceSnapshotMs: number;
  // ms elapsed since the serving party entered the chair (earliest servedAt
  // across its members), or null if nobody is currently being served.
  servingElapsedMs: number | null;
  // Total booked minutes for the serving entry's WHOLE party (every member,
  // not just the one in the chair — a party occupies the chair until its
  // last member finishes), or null if nobody is currently being served.
  servingBookedMinutes: number | null;
}

// Elapsed ms on the IN-CHAIR member's own clock — measured from that member's
// own servedAt, not the party's earliest.
//
// Exactly one member occupies the chair at a time, and the backend stamps each
// a fresh servedAt as they take it (QueuesService auto-advance; `extend` also
// re-anchors it). So the in-chair member's own servedAt is what their
// remaining time is measured against — mirroring the backend's
// remainingDurationOf (timeline.service.ts), which this must stay in step with.
//
// This used to take the party's earliest servedAt, matching the backend's
// previous party-total behaviour. Both changed together: the old rule zeroed
// out untouched members once one member overran the party total.
//
// Returns null if nobody is in the chair or they have no servedAt yet.
export function servingElapsedMsFor(entry: TimelineEntryDto, nowMs: number): number | null {
  const inChair = entry.members.find((m) => m.status === 'SERVING');
  if (!inChair?.servedAt) return null;
  return nowMs - new Date(inChair.servedAt).getTime();
}

// The in-chair member's own booked minutes — the correct threshold for "has
// this member run past what they booked?". Pairs with servingElapsedMsFor:
// same member, same clock. Null if nobody is in the chair.
//
// Deliberately NOT the party total: with per-member accounting a party of
// 3 × 30 min is not "90 minutes of chair time" that can overrun as one block;
// each member consumes their own booking independently.
export function servingBookedMinutesFor(entry: TimelineEntryDto): number | null {
  const inChair = entry.members.find((m) => m.status === 'SERVING');
  return inChair ? inChair.serviceDuration : null;
}

// Minutes a SERVING entry still needs from the barber, computed PER MEMBER.
// Mirrors the backend's remainingDurationOf (timeline.service.ts) exactly —
// keep the two in step, because this feeds an optimistic paint that the
// server's own number replaces moments later, and any divergence shows up as
// a visible jump:
//   in the chair (SERVING)   → max(0, its own duration − minutes since ITS
//                              OWN servedAt); no servedAt yet → full duration
//   still WAITING            → its full duration (none of it consumed)
//   SERVED/NO_SHOW/CANCELLED → 0 (finished; contributes nothing)
//
// Never elapsed-vs-party-total: that zeroed out untouched members once one
// member ran past the party's combined booking (a 3 × 30 min party whose
// first member was 120 min in reported 0 instead of 60).
export function entryRemainingMinutes(entry: TimelineEntryDto, nowMs: number): number {
  let remaining = 0;
  for (const m of entry.members) {
    if (m.status === 'SERVED' || m.status === 'NO_SHOW' || m.status === 'CANCELLED') continue;
    if (m.status === 'SERVING') {
      if (!m.servedAt) {
        remaining += m.serviceDuration;
        continue;
      }
      const elapsedMin = (nowMs - new Date(m.servedAt).getTime()) / 60_000;
      remaining += Math.max(0, m.serviceDuration - elapsedMin);
      continue;
    }
    remaining += m.serviceDuration;
  }
  return remaining;
}

// True once the serving party has run longer than it was booked for. Past
// this point the backend's last-known projection is built on an assumption
// (the barber finishes on schedule) that has already failed, so continuing to
// count down would promise a turn that isn't coming — waits behind it freeze
// (see effectiveSinceSnapshotMs, the only production caller).
//
// Takes just the two fields it reads rather than a whole WaitContext, so it
// composes with effectiveSinceSnapshotMs — which must answer "is it stale?"
// before it has a sinceSnapshotMs to put in a context.
export function isProjectionStale(params: {
  servingElapsedMs: number | null;
  servingBookedMinutes: number | null;
}): boolean {
  if (params.servingElapsedMs === null || params.servingBookedMinutes === null) return false;
  return params.servingElapsedMs > params.servingBookedMinutes * 60_000;
}

// How much of the snapshot's age actually counts toward the countdown.
//
// Only ticks down in real time while someone is actually SERVING: the
// backend's estimatedWaitMinutes decays for the entries behind a serving
// party specifically because that party is consuming real, elapsing time
// (remainingDurationOf subtracts elapsed-since-servedAt). With NOBODY
// serving, estimatedWaitMinutes is a plain sum of durations — a static
// snapshot with no clock running against it, since there is no servedAt to
// project from until a barber actually calls someone. Ticking it down
// anyway was the bug: a fully-idle queue's wait numbers would silently drain
// toward 0 in real time even though nothing was actually happening. So
// servingElapsedMs === null (nobody serving) freezes at age 0 — hold exactly
// what the snapshot said until a real frame arrives, same "don't extrapolate
// past what's honest" principle as the overrun freeze below, just for the
// opposite reason (no clock to project from, rather than a clock that's run
// out).
//
// Once someone genuinely is serving, the countdown resumes as the full age
// (now - snapshotAt) — until the serving party overruns its booking, at
// which point the projection's premise has failed and the countdown must
// stop again — everyone behind holds their last honest number until a real
// frame arrives.
//
// The overrun freeze point is computed, not latched. Staleness begins at
// exactly `partyServedAt + booked`, so the age to hold is that instant minus
// snapshotAt — no mutable "when did we first notice" state, which would make
// this a side effect inside a computed() and would drift with tick timing.
// Verified equal to a per-tick latch up to tick granularity, and consumers
// floor to whole minutes anyway.
export function effectiveSinceSnapshotMs(params: {
  nowMs: number;
  snapshotAtMs: number | null;
  servingElapsedMs: number | null;
  servingBookedMinutes: number | null;
}): number {
  const { nowMs, snapshotAtMs, servingElapsedMs, servingBookedMinutes } = params;
  if (snapshotAtMs === null) return 0;
  if (servingElapsedMs === null) return 0;

  const age = Math.max(0, nowMs - snapshotAtMs);
  if (!isProjectionStale({ servingElapsedMs, servingBookedMinutes })) return age;

  // Overrun: hold the age as it was at the instant the booking ran out.
  // servingBookedMinutes non-null here — isProjectionStale only returns true
  // when both params are set, and servingElapsedMs is already known non-null.
  const bookedMs = servingBookedMinutes! * 60_000;
  const partyServedAtMs = nowMs - servingElapsedMs;
  const staleFromMs = partyServedAtMs + bookedMs;
  return Math.max(0, staleFromMs - snapshotAtMs);
}

export function computeLiveWaitMinutes(ctx: WaitContext): Map<string, number> {
  const sinceSnapshotMinutes = Math.floor(ctx.sinceSnapshotMs / 60_000);
  const map = new Map<string, number>();
  for (const entry of ctx.timeline) {
    map.set(entry.entryId, Math.max(0, entry.estimatedWaitMinutes - sinceSnapshotMinutes));
  }
  return map;
}

export function computeMemberWaitMinutes(ctx: WaitContext): Map<string, number> {
  const liveWaits = computeLiveWaitMinutes(ctx);
  const map = new Map<string, number>();
  for (const entry of ctx.timeline) {
    const isServing = entry.members.some((m) => m.status === 'SERVING');
    // The first waiting member's wait is the entry's own live wait (until the
    // entry reaches the front) — matches what the entry card shows via
    // computeLiveWaitMinutes(). Each later member additionally waits for the
    // earlier members ahead of them to finish (pendingDuration).
    const liveEntryWait = liveWaits.get(entry.entryId) ?? 0;
    let pendingDuration = 0;
    for (const member of entry.members) {
      if (member.status === 'SERVED') {
        map.set(member.memberId, 0);
        continue;
      }
      if (member.status === 'SERVING') {
        map.set(member.memberId, 0);
        // Seed pendingDuration with the IN-CHAIR member's own remaining time
        // only — not the whole party's total duration. Per-member accounting
        // (see servingElapsedMsFor/servingBookedMinutesFor/entryRemainingMinutes
        // above): exactly one member is ever actually being worked on, and
        // each member's time is consumed independently, on their own clock.
        // The loop below already adds every later member's own serviceDuration
        // on top of this (line "pendingDuration += member.serviceDuration"),
        // so summing the whole party in here as well double-counted every
        // waiting member's own duration into the very total they were meant
        // to be added onto — a party of 3 x 5min reported the second member
        // waiting 15m (should be 5) and the third 20m (should be 10).
        //
        // Anchored to servingElapsedMs (elapsed since THIS member's own
        // servedAt), not sinceSnapshotMinutes (elapsed since the frame
        // arrived) — different clocks. Floored at 0: an overrun must never
        // leave pendingDuration negative, which would drag every member
        // behind this entry down with it (the original memberWaitMinutes bug).
        const servingElapsedMinutes = Math.floor((ctx.servingElapsedMs ?? 0) / 60_000);
        pendingDuration = Math.max(0, member.serviceDuration - servingElapsedMinutes);
        continue;
      }
      const wait = isServing
        ? Math.max(0, pendingDuration)
        : Math.max(0, liveEntryWait + pendingDuration);
      map.set(member.memberId, wait);
      pendingDuration += member.serviceDuration;
    }
  }
  return map;
}

export function formatWait(minutes: number): string {
  if (minutes < 1) return '< 1m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
