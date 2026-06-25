import { Injectable } from '@angular/core';

export interface GuestEntry {
  readonly queueId: string;
  readonly entryId: string;
  readonly salonId: string;
  readonly salonSlug: string;
}

interface GuestStoreData {
  readonly token: string;
  readonly entries: GuestEntry[];
  readonly lastPath: string;
}

const STORAGE_KEY = 'hairmela_guest';

@Injectable({ providedIn: 'root' })
export class GuestStore {
  getStore(): GuestStoreData | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as GuestStoreData) : null;
    } catch {
      return null;
    }
  }

  hasToken(): boolean {
    return this.getToken() !== null;
  }

  getToken(): string | null {
    return this.getStore()?.token ?? null;
  }

  setToken(token: string): void {
    const existing = this.getStore();
    this._write({
      token,
      entries: existing?.entries ?? [],
      lastPath: existing?.lastPath ?? '/g/queues',
    });
  }

  addEntry(entry: GuestEntry): void {
    const store = this.getStore();
    if (!store) return;
    const filtered = store.entries.filter((e) => e.queueId !== entry.queueId);
    this._write({ ...store, entries: [...filtered, entry] });
  }

  removeEntry(queueId: string): void {
    const store = this.getStore();
    if (!store) return;
    this._write({ ...store, entries: store.entries.filter((e) => e.queueId !== queueId) });
  }

  /** Removes entries whose entryId is no longer in the live list (served/cancelled). */
  syncEntries(liveEntryIds: string[]): void {
    const store = this.getStore();
    if (!store) return;
    const live = new Set(liveEntryIds);
    this._write({ ...store, entries: store.entries.filter((e) => live.has(e.entryId)) });
  }

  setLastPath(path: string): void {
    const store = this.getStore();
    if (!store) return;
    this._write({ ...store, lastPath: path });
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }

  private _write(data: GuestStoreData): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }
}
