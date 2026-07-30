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
//
// iOS Safari (and any home-screen "Add to Home Screen" PWA, which is an even
// stricter WebKit context) needs more than "some click happened somewhere" —
// the unlock has to happen from a real, synchronous user-gesture event
// handler acting on THIS SPECIFIC element, not from an async callback (a
// socket event handler is exactly the kind of async callback that doesn't
// count). warmUp() does that: play()-then-immediately-pause() inside the
// gesture handler itself. It's called once, app-wide, on the first
// pointerdown anywhere in the app (see app.ts) — not per-page — so it's
// already unlocked by the time a barber navigates from wherever they land
// (e.g. Salon Overview) into the queue console.
@Injectable({ providedIn: 'root' })
export class QueueSoundService {
  private readonly _preference = inject(QueueSoundPreferenceService);
  private _audio: HTMLAudioElement | null = null;
  private _warmedUp = false;

  /** Call once, synchronously, from inside a real user-gesture event handler. */
  warmUp(): void {
    if (this._warmedUp) return;
    this._warmedUp = true;
    const audio = this._ensureAudio();
    // Muted for the warm-up itself — on iOS, play()-then-pause() can still
    // let a brief blip of the real chime through before pause() lands
    // (no silence padding in the WAV, so playback is audible from frame 0).
    // This is pure unlock; nothing about it should be heard.
    audio.muted = true;
    audio.play()
      .then(() => {
        audio.pause();
        audio.muted = false;
      })
      .catch(() => {
        // Still locked (e.g. this "first interaction" wasn't the kind iOS
        // counts) — next warmUp() call this session will retry, since we
        // only flip _warmedUp before knowing whether it actually worked.
        // That's intentional: retrying on every future gesture is cheap and
        // self-healing, versus giving up after one failed attempt.
        audio.muted = false;
        this._warmedUp = false;
      });
  }

  play(): void {
    if (!this._preference.enabled()) return;
    const audio = this._ensureAudio();
    // Restart from the top if it's still playing from a rapid prior event,
    // rather than overlapping two instances or silently no-op'ing.
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Autoplay blocked (no user interaction yet this page load) or the
      // browser otherwise refused — nothing to recover from, just stay silent.
    });
  }

  private _ensureAudio(): HTMLAudioElement {
    if (!this._audio) {
      this._audio = new Audio('/sounds/queue-chime.wav');
    }
    return this._audio;
  }
}
