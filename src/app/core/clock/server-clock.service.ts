import { Injectable, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';

// Drift-corrected clock: server-provided timestamps are truth, the client's own
// Date.now() may be skewed. sync() records the offset once per fresh server
// timestamp; now() applies it so elapsed-time math stays correct regardless of
// the client's clock. tick() is a signal consumers read to force periodic
// recomputation of anything derived from now().
@Injectable({ providedIn: 'root' })
export class ServerClockService {
  private readonly _document = inject(DOCUMENT);

  private _offsetMs = 0;

  readonly tick = signal(0);

  private _tickInterval: ReturnType<typeof setInterval> | null = null;
  private _visibilityListener: (() => void) | null = null;

  // Call whenever a fresh server timestamp arrives (e.g. on a timeline payload).
  sync(serverTimeIso: string): void {
    this._offsetMs = new Date(serverTimeIso).getTime() - Date.now();
  }

  // Drift-corrected "now", in place of a raw Date.now() call.
  now(): number {
    return Date.now() + this._offsetMs;
  }

  start(): void {
    if (this._tickInterval) return;
    this._tickInterval = setInterval(() => this.tick.update((n) => n + 1), 1000);
    this._visibilityListener = () => {
      if (this._document.visibilityState === 'visible') this.tick.update((n) => n + 1);
    };
    this._document.addEventListener('visibilitychange', this._visibilityListener);
  }

  stop(): void {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
    if (this._visibilityListener) {
      this._document.removeEventListener('visibilitychange', this._visibilityListener);
      this._visibilityListener = null;
    }
  }
}
