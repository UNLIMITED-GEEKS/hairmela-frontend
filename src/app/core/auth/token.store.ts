import { Injectable, computed, signal } from '@angular/core';

const REFRESH_TOKEN_KEY = 'hm_refresh_token';

@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly _accessToken = signal<string | null>(null);

  readonly isAuthenticated = computed(() => this._accessToken() !== null);

  getAccessToken(): string | null {
    return this._accessToken();
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  setTokens(accessToken: string, refreshToken: string): void {
    this._accessToken.set(accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }

  clearTokens(): void {
    this._accessToken.set(null);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}
