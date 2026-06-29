import { Injectable, inject } from '@angular/core';
import { PersistentStore } from '../storage/persistent-store';

interface GuestStoreData {
  readonly token: string;
  readonly lastPath: string;
}

const STORAGE_KEY = 'hairmela_guest';

/**
 * Holds the anonymous caller's identity (guest token) and last-visited path.
 * Queue entries are NOT stored here — those live in ActiveEntryStore, the single
 * owner of entry state for both guests and signed-in users.
 */
@Injectable({ providedIn: 'root' })
export class GuestStore {
  private readonly _storage = inject(PersistentStore);

  hasToken(): boolean {
    return this.getToken() !== null;
  }

  getToken(): string | null {
    return this._read()?.token ?? null;
  }

  setToken(token: string): void {
    const existing = this._read();
    this._storage.set<GuestStoreData>(STORAGE_KEY, {
      token,
      lastPath: existing?.lastPath ?? '/g/queues',
    });
  }

  getLastPath(): string {
    return this._read()?.lastPath ?? '/g/queues';
  }

  setLastPath(path: string): void {
    const existing = this._read();
    if (!existing) return;
    this._storage.set<GuestStoreData>(STORAGE_KEY, { ...existing, lastPath: path });
  }

  clear(): void {
    this._storage.remove(STORAGE_KEY);
  }

  private _read(): GuestStoreData | null {
    return this._storage.get<GuestStoreData>(STORAGE_KEY);
  }
}
