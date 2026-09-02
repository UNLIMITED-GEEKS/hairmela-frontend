import { Injectable, computed, inject, signal } from '@angular/core';
import { PersistentStore } from '../storage/persistent-store';

const REFRESH_TOKEN_KEY = 'hm_refresh_token';
const ACCESS_TOKEN_KEY = 'hm_access_token';

/**
 * Seconds of remaining life a stored access token must have to be trusted at
 * boot. A token about to expire is treated as already expired, so we do not
 * start the session on one that dies mid-request.
 */
const ACCESS_TOKEN_MIN_TTL_S = 30;

/**
 * True when a JWT's `exp` is at least ACCESS_TOKEN_MIN_TTL_S away.
 *
 * Read-only inspection of a token we already hold — this is not verification.
 * The signature still decides whether the server accepts it; this only avoids
 * sending one we can already tell is stale. Anything unparseable returns false
 * and falls back to the refresh call, so a malformed value degrades to today's
 * behaviour rather than breaking the session.
 */
function hasUsableTtl(token: string): boolean {
  try {
    const [, payload] = token.split('.');
    if (!payload) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    if (typeof json.exp !== 'number') return false;
    return json.exp - Date.now() / 1000 > ACCESS_TOKEN_MIN_TTL_S;
  } catch {
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly _storage = inject(PersistentStore);

  // Seeded from storage so a cold start does not have to wait on the network
  // to know it is signed in. Before this, the access token lived only in memory
  // and sessionInit had to await POST /auth/refresh — measured at ~1.2s on a
  // real connection — before the router could activate a single route. The
  // refresh token was already persisted, so this stores its short-lived
  // companion beside it rather than introducing a new class of stored secret.
  //
  // A stored token that turns out to be rejected is not a problem: the 401
  // path in refresh.interceptor already refreshes and retries transparently.
  // hasUsableTtl only avoids paying for that round-trip when we can tell
  // locally that it would fail.
  private readonly _accessToken = signal<string | null>(null);
  /**
   * Whether storage has been consulted yet. NOT read in a field initializer:
   * TokenStore is providedIn 'root', so it can be constructed before
   * PersistentStore.hydrate() has filled its cache on native — and getRaw()
   * reads that cache, so an eager read would see nothing and silently fall
   * back to the network path this exists to avoid. Seeding on first ACCESS
   * instead means the read happens once sessionInit has awaited hydrate().
   */
  private _seeded = false;

  readonly isAuthenticated = computed(() => this._accessToken() !== null);

  /**
   * Load the stored token into the signal, once. Called explicitly from
   * sessionInit AFTER PersistentStore.hydrate() has resolved — not from a
   * computed, which must never write to a signal, and not from the field
   * initializer, which can run before the native cache exists.
   */
  restoreFromStorage(): void {
    if (this._seeded) return;
    this._seeded = true;
    const stored = this._storage.getRaw(ACCESS_TOKEN_KEY);
    if (stored && hasUsableTtl(stored)) this._accessToken.set(stored);
  }

  getAccessToken(): string | null {
    return this._accessToken();
  }

  getRefreshToken(): string | null {
    return this._storage.getRaw(REFRESH_TOKEN_KEY);
  }

  setTokens(accessToken: string, refreshToken: string): void {
    this._accessToken.set(accessToken);
    this._storage.setRaw(ACCESS_TOKEN_KEY, accessToken);
    this._storage.setRaw(REFRESH_TOKEN_KEY, refreshToken);
  }

  clearTokens(): void {
    this._accessToken.set(null);
    this._storage.remove(ACCESS_TOKEN_KEY);
    this._storage.remove(REFRESH_TOKEN_KEY);
  }
}
