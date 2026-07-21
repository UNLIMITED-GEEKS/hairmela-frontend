import { Injectable, inject } from '@angular/core';
import { QueueSoundPreferenceService } from './queue-sound-preference.service';

// Real playback for the queue-update notification chime. Gated on the
// account-level on/off preference (QueueSoundPreferenceService) AND on the
// event's source being CUSTOMER — see QueueSocketService for where source
// is read off the queueTimeline socket payload and this is actually called.
//
// Plain HTMLAudioElement, not the Web Audio API — this is a single short
// clip with no need for mixing/timing precision, and Audio() degrades
// silently (a rejected play() promise, not a thrown error) when the
// browser's autoplay-after-interaction policy blocks it, which is the
// correct fallback here: a barber who has the console open and has already
// clicked something this session will have unlocked audio; a page that's
// never been interacted with just stays silent instead of erroring.
@Injectable({ providedIn: 'root' })
export class QueueSoundService {
  private readonly _preference = inject(QueueSoundPreferenceService);
  private _audio: HTMLAudioElement | null = null;

  play(): void {
    if (!this._preference.enabled()) return;
    if (!this._audio) {
      this._audio = new Audio('/sounds/queue-chime.wav');
    }
    // Restart from the top if it's still playing from a rapid prior event,
    // rather than overlapping two instances or silently no-op'ing.
    this._audio.currentTime = 0;
    this._audio.play().catch(() => {
      // Autoplay blocked (no user interaction yet this page load) or the
      // browser otherwise refused — nothing to recover from, just stay silent.
    });
  }
}
