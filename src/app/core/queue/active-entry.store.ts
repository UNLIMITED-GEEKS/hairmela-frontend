import { Injectable, inject } from '@angular/core';
import { PersistentStore } from '../storage/persistent-store';

export interface ActiveEntry {
  readonly queueId: string;
  readonly entryId: string;
  readonly salonId: string;
  readonly salonSlug: string;
  // memberId -> the name the caller typed when joining/booking.
  //
  // The public timeline (GET /queues/:queueId/timeline) blanks memberName for
  // every entry — including the caller's own, since that endpoint has no
  // notion of "which entry is mine" — so my-position merges this back in at
  // read time instead of asking the backend to un-redact anything.
  //
  // Names come from the REQUEST we sent, not the response: the backend's
  // join/book responses don't include the created members on the wire despite
  // what the generated types claim (confirmed live — entry.members is
  // undefined on walk-in join). That means real member ids aren't known at
  // creation time either, so names start out position-keyed (see
  // pendingMemberNames) and are bound to their ids on the first timeline
  // frame, while positions are still trustworthy.
  //
  // Keyed by id rather than position because a member can be REMOVED from a
  // party, and a removed member disappears from the timeline's members array
  // entirely — every member behind them shifts down an index. Position-keyed
  // names would then land on the wrong people silently.
  readonly memberNames?: Record<string, string>;

  // Names captured at creation, still keyed by position (0 = leader), waiting
  // to be bound to real member ids. Cleared once bound — see
  // ActiveEntryStore.bindMemberNames. Only ever read for an entry that has
  // not yet seen a timeline frame, so the position keys are still correct.
  readonly pendingMemberNames?: Record<number, string>;
}

const ENTRIES_KEY = 'hairmela_active_entries';

/**
 * The single home for the caller's queue entries (one customer may hold several
 * in a queue after adding-while-waiting). Identity-agnostic: it persists the
 * same list whether the caller is a signed-in user or a guest — the entry list
 * is cleared on every identity transition (login/register/logout), so there is
 * no cross-account bleed and no need to branch on who the caller is.
 */
@Injectable({ providedIn: 'root' })
export class ActiveEntryStore {
  private readonly _storage = inject(PersistentStore);

  getAll(): ActiveEntry[] {
    return this._storage.get<ActiveEntry[]>(ENTRIES_KEY) ?? [];
  }

  /** All stored entries for a queue — a customer may hold several (added-while-waiting). */
  getAllForQueue(queueId: string): ActiveEntry[] {
    return this.getAll().filter((e) => e.queueId === queueId);
  }

  getByEntryId(entryId: string): ActiveEntry | null {
    return this.getAll().find((e) => e.entryId === entryId) ?? null;
  }

  /** The name the caller typed for one of their own party members, or null if unknown. */
  getMemberName(entryId: string, memberId: string): string | null {
    return this.getByEntryId(entryId)?.memberNames?.[memberId] ?? null;
  }

  /**
   * Binds creation-time names (position-keyed) to the real member ids from the
   * first timeline frame for this entry, then drops the positional map.
   *
   * Must run against a frame where positions still line up with creation
   * order — i.e. before any member is removed from the party. _reconcileEntries
   * calls this on every frame, so in practice it binds on the first one, long
   * before a removal is possible. No-op once bound (or if there was nothing to
   * bind), so later frames cost a single property check.
   *
   * `memberIdsInOrder` must be the entry's members exactly as the timeline
   * lists them: leader first, then creation order (the backend orders by
   * isLeader DESC, createdAt ASC).
   */
  bindMemberNames(entryId: string, memberIdsInOrder: string[]): void {
    const entry = this.getByEntryId(entryId);
    if (!entry?.pendingMemberNames) return;

    const pending = entry.pendingMemberNames;
    const memberNames: Record<string, string> = { ...(entry.memberNames ?? {}) };
    memberIdsInOrder.forEach((memberId, position) => {
      const name = pending[position];
      if (name !== undefined) memberNames[memberId] = name;
    });

    const { pendingMemberNames: _dropped, ...rest } = entry;
    this.save({ ...rest, memberNames });
  }

  save(entry: ActiveEntry): void {
    const entries = this.getAll().filter((e) => e.entryId !== entry.entryId);
    entries.push(entry);
    this._storage.set(ENTRIES_KEY, entries);
  }

  remove(entryId: string): void {
    this._storage.set(ENTRIES_KEY, this.getAll().filter((e) => e.entryId !== entryId));
  }

  /** Drops stored entries whose id is no longer live (served/cancelled). */
  syncEntries(liveEntryIds: string[]): void {
    const live = new Set(liveEntryIds);
    this._storage.set(ENTRIES_KEY, this.getAll().filter((e) => live.has(e.entryId)));
  }

  clear(): void {
    this._storage.remove(ENTRIES_KEY);
  }
}
