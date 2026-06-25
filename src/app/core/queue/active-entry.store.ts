import { Injectable, computed, inject } from '@angular/core';
import { TokenStore } from '../auth/token.store';
import { GuestStore } from '../guest/guest-store';

export interface ActiveEntry {
  readonly queueId: string;
  readonly entryId: string;
  readonly salonId: string;
  readonly salonSlug: string;
}

const AUTH_ENTRY_KEY = 'hairmela_active_entries';

@Injectable({ providedIn: 'root' })
export class ActiveEntryStore {
  private readonly _tokenStore = inject(TokenStore);
  private readonly _guestStore = inject(GuestStore);

  private readonly _isGuest = computed(
    () => this._guestStore.hasToken() && !this._tokenStore.isAuthenticated(),
  );

  getAll(): ActiveEntry[] {
    if (this._isGuest()) return this._getGuestEntries();
    return this._getAuthEntries();
  }

  getForQueue(queueId: string): ActiveEntry | null {
    return this.getAll().find((e) => e.queueId === queueId) ?? null;
  }

  save(entry: ActiveEntry): void {
    if (this._isGuest()) {
      this._guestStore.addEntry(entry);
      return;
    }
    const entries = this._getAuthEntries().filter((e) => e.queueId !== entry.queueId);
    entries.push(entry);
    this._writeAuth(entries);
  }

  remove(queueId: string): void {
    if (this._isGuest()) {
      this._guestStore.removeEntry(queueId);
      return;
    }
    this._writeAuth(this._getAuthEntries().filter((e) => e.queueId !== queueId));
  }

  clear(): void {
    try {
      localStorage.removeItem(AUTH_ENTRY_KEY);
    } catch { /* ignore */ }
  }

  private _getGuestEntries(): ActiveEntry[] {
    return (this._guestStore.getStore()?.entries ?? []) as ActiveEntry[];
  }

  private _getAuthEntries(): ActiveEntry[] {
    try {
      const raw = localStorage.getItem(AUTH_ENTRY_KEY);
      return raw ? (JSON.parse(raw) as ActiveEntry[]) : [];
    } catch { return []; }
  }

  private _writeAuth(entries: ActiveEntry[]): void {
    try {
      localStorage.setItem(AUTH_ENTRY_KEY, JSON.stringify(entries));
    } catch { /* ignore */ }
  }
}
