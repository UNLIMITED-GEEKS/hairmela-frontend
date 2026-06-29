import { Injectable, computed, inject, signal } from '@angular/core';
import { PersistentStore } from '../storage/persistent-store';

const REFRESH_TOKEN_KEY = 'hm_refresh_token';

@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly _storage = inject(PersistentStore);

  private readonly _accessToken = signal<string | null>(null);

  readonly isAuthenticated = computed(() => this._accessToken() !== null);

  getAccessToken(): string | null {
    return this._accessToken();
  }

  getRefreshToken(): string | null {
    return this._storage.getRaw(REFRESH_TOKEN_KEY);
  }

  setTokens(accessToken: string, refreshToken: string): void {
    this._accessToken.set(accessToken);
    this._storage.setRaw(REFRESH_TOKEN_KEY, refreshToken);
  }

  clearTokens(): void {
    this._accessToken.set(null);
    this._storage.remove(REFRESH_TOKEN_KEY);
  }
}
