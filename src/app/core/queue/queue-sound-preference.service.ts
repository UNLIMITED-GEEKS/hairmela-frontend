import { Injectable, inject, signal } from '@angular/core';
import { PersistentStore } from '../storage/persistent-store';

const SOUND_ENABLED_KEY = 'hm_queue_sound_enabled';

// Local-only preference (no backend endpoint) — whether a barber wants a
// sound to play on their queue console when their queue changes. Real
// playback isn't wired yet: the backend can't yet tell the frontend whether
// a queue.updated event was customer-initiated (should play) or
// staff-initiated (shouldn't) — see queue-socket.service.ts's TODO once that
// ships. For now this only drives the settings toggle + the console's
// "sound is off" banner.
@Injectable({ providedIn: 'root' })
export class QueueSoundPreferenceService {
  private readonly _store = inject(PersistentStore);

  private readonly _enabled = signal(this._store.get<boolean>(SOUND_ENABLED_KEY) ?? true);

  readonly enabled = this._enabled.asReadonly();

  setEnabled(value: boolean): void {
    this._enabled.set(value);
    this._store.set(SOUND_ENABLED_KEY, value);
  }
}
