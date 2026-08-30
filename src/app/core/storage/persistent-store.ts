import { Injectable, inject } from '@angular/core';
import { AppPlatformService } from '../native/app-platform.service';

// Keys this app owns. Needed because Capacitor Preferences must be read key by
// key to build the boot cache — unlike localStorage, there is no synchronous
// way to enumerate and read everything at once. Any new persisted key MUST be
// added here or it will not survive an app restart on native.
const PERSISTED_KEYS = [
  'hm_refresh_token',
  'hm_last_selected_salon_id',
  'hm_cookie_consent',
  'hm_push_asked',
  'hm_pwa_installed',
  'hm_queue_sound_enabled',
  'hm_sidebar_collapsed',
  'hm_theme',
  'hairmela_guest',
  'hairmela_active_entries',
] as const;

/**
 * Single gateway to persistent storage. Centralises the try/catch and JSON
 * handling that every store would otherwise repeat. Reads/writes fail silently
 * — a private-mode or WebView quirk degrades to "no persistence", never a crash.
 *
 * TWO BACKINGS, ONE SYNCHRONOUS API:
 *
 *   web    → localStorage directly, exactly as before. Same keys, same values,
 *            same behaviour. Existing users' sessions are untouched.
 *   native → Capacitor Preferences, which survives Android clearing the
 *            WebView's web data (localStorage does NOT — the OS can wipe it and
 *            silently sign the user out).
 *
 * THE ASYNC TRAP THIS AVOIDS: Preferences is a Promise API, but every method
 * here is synchronous and `TokenStore.getRefreshToken()` is called from
 * `jwt.interceptor` — HTTP interceptors are painful to make async, and the
 * change would ripple through refresh.interceptor, session-init and
 * guest-store. So on native the whole store is read into an in-memory cache
 * ONCE at boot (`hydrate()`), reads are served synchronously from that cache,
 * and writes update the cache immediately then persist in the background
 * (fire-and-forget). No call site changes; all 10 of them still see a plain
 * synchronous API.
 *
 * ORDERING IS LOAD-BEARING — AND PROVIDER ORDER DOES NOT PROVIDE IT.
 * hydrate() must complete before anything reads storage. Angular runs
 * provideAppInitializer callbacks in PARALLEL and only waits for them
 * collectively, so registering hydrate() "first" in app.config.ts does not make
 * it finish first. Every startup reader must await hydrate() itself;
 * `sessionInit` does. It is idempotent, so the eager call in app.config.ts and
 * sessionInit's await share a single hydration pass.
 *
 * This was a real bug, not a hypothetical: relying on provider order alone left
 * getRefreshToken() reading an empty cache while hydration was still in flight,
 * and every native cold start appeared signed out — even though the token was
 * correctly stored in Preferences the whole time.
 */
@Injectable({ providedIn: 'root' })
export class PersistentStore {
  private readonly _platform = inject(AppPlatformService);

  // Native only. Mirrors Preferences so reads can stay synchronous.
  private readonly _cache = new Map<string, string>();

  // In-flight (or completed) hydration, so repeat calls share one pass.
  private _hydration?: Promise<void>;

  /**
   * Load Preferences into the in-memory cache. No-op on web, where
   * localStorage is already synchronous.
   *
   * Idempotent and safe to call concurrently: the in-flight promise is cached,
   * so every caller awaits the SAME hydration rather than racing a second one.
   * Callers must await it before reading — `sessionInit` does exactly that.
   */
  hydrate(): Promise<void> {
    if (!this._platform.isNative) return Promise.resolve();
    return (this._hydration ??= this._doHydrate());
  }

  private async _doHydrate(): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const entries = await Promise.all(
        PERSISTED_KEYS.map(async (key) => [key, (await Preferences.get({ key })).value] as const),
      );
      for (const [key, value] of entries) {
        if (value !== null) this._cache.set(key, value);
      }
    } catch {
      // Preferences unavailable: degrade to an empty cache (= "nothing stored")
      // rather than blocking app start. Same silent-failure contract as the
      // localStorage try/catch below.
    }
  }

  /** JSON value, or null if absent/unparseable/unavailable. */
  get<T>(key: string): T | null {
    const raw = this.getRaw(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      this.setRaw(key, JSON.stringify(value));
    } catch { /* ignore — value not serialisable */ }
  }

  /** Plain string value (for non-JSON payloads like a raw token). */
  getRaw(key: string): string | null {
    if (this._platform.isNative) return this._cache.get(key) ?? null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setRaw(key: string, value: string): void {
    if (this._platform.isNative) {
      // Cache first so an immediate read-back sees the new value, then persist
      // in the background — callers are synchronous and cannot await this.
      this._cache.set(key, value);
      void this._persist(key, value);
      return;
    }
    try {
      localStorage.setItem(key, value);
    } catch { /* ignore */ }
  }

  remove(key: string): void {
    if (this._platform.isNative) {
      this._cache.delete(key);
      void this._removePersisted(key);
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
  }

  private async _persist(key: string, value: string): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
    } catch { /* ignore — cache still holds it for this session */ }
  }

  private async _removePersisted(key: string): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
    } catch { /* ignore */ }
  }
}
