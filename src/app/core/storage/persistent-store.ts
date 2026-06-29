import { Injectable } from '@angular/core';

/**
 * Single gateway to persistent browser storage. Centralises the try/catch and
 * JSON handling that every store would otherwise repeat, and gives one place to
 * swap the backing mechanism (sessionStorage, encrypted storage, a WebView
 * shim for Capacitor) without touching any store. Reads/writes fail silently —
 * a private-mode or WebView quirk degrades to "no persistence", never a crash.
 */
@Injectable({ providedIn: 'root' })
export class PersistentStore {
  /** JSON value, or null if absent/unparseable/unavailable. */
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* ignore */ }
  }

  /** Plain string value (for non-JSON payloads like a raw token). */
  getRaw(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setRaw(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch { /* ignore */ }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
  }
}
