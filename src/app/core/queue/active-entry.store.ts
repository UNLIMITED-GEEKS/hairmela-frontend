import { Injectable, inject } from '@angular/core';
import { PersistentStore } from '../storage/persistent-store';

export interface ActiveEntry {
  readonly queueId: string;
  readonly entryId: string;
  readonly salonId: string;
  readonly salonSlug: string;
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
