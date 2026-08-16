import { DestroyRef, Injectable, Signal, effect, inject, signal } from '@angular/core';

/** Undoes a registration. Safe to call more than once. */
export type OverlayRelease = () => void;

/**
 * Stack of currently-open dismissable overlays (dialogs, modals, lightboxes).
 *
 * WHY THIS EXISTS: the app's dialogs are presentational — each takes
 * `open` as an `input.required<boolean>()` owned by its parent and closes by
 * emitting `closed`. That means no root-level service can find or dismiss
 * "whatever dialog is currently open", because the state lives in whichever of
 * the 12 parent templates happens to be hosting one. A base class does not
 * solve this either: inheritance shares code, not instances. So open overlays
 * register themselves here and the top of the stack can be dismissed by
 * anything that needs to — currently the Android hardware back button.
 *
 * NOT NATIVE-ONLY BY DESIGN. "Dismiss the top overlay" is one behaviour with
 * two triggers — Android back and the Escape key. Scoping this to Capacitor
 * would fork dialog behaviour by platform and leave the web path to rot. Cost
 * on web is a push/pop into an array.
 *
 * A stack, not a single slot, because overlays can legitimately nest (a
 * gallery lightbox opened from inside a booking dialog) and the most recently
 * opened must always be the first dismissed.
 */
@Injectable({ providedIn: 'root' })
export class OverlayRegistry {
  private readonly _stack = signal<OverlayRelease[]>([]);

  /** True when at least one overlay is open. */
  readonly hasOpen = () => this._stack().length > 0;

  /**
   * Register an open overlay's close callback. Returns a release function the
   * caller MUST invoke when the overlay closes (including on destroy), so a
   * dialog torn down while open cannot strand an entry in the stack.
   */
  register(close: () => void): OverlayRelease {
    this._stack.update((stack) => [...stack, close]);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._stack.update((stack) => stack.filter((entry) => entry !== close));
    };
  }

  /**
   * Close the most recently opened overlay. Returns true if one was dismissed,
   * false when nothing was open — letting callers fall through to their own
   * behaviour (e.g. back navigation).
   *
   * The entry is NOT popped here: invoking `close` makes the owning component
   * emit `closed`, the parent flips its `open` input, and the component's own
   * effect calls the release function. Popping here as well would desynchronise
   * the stack from what is actually on screen.
   */
  closeTop(): boolean {
    const stack = this._stack();
    const top = stack[stack.length - 1];
    if (!top) return false;
    top();
    return true;
  }
}

/**
 * Keeps an overlay component registered for exactly as long as `open` is true,
 * and releases it on close or destroy.
 *
 * Call once from a dialog's constructor (injection context required):
 *
 *   registerOverlayWhileOpen(this.open, () => this.close());
 *
 * Exists so the five dialog components share one correct implementation
 * instead of five hand-copied register/release blocks — each of those would be
 * an opportunity to forget the destroy case and strand a stale entry in the
 * stack. Deliberately a standalone function rather than a base class: these
 * dialogs already extend nothing and differ in constructor shape, and a
 * function composes without dictating inheritance.
 */
export function registerOverlayWhileOpen(open: Signal<boolean>, close: () => void): void {
  const overlays = inject(OverlayRegistry);
  let release: OverlayRelease | undefined;

  effect(() => {
    if (open()) {
      release ??= overlays.register(close);
    } else {
      release?.();
      release = undefined;
    }
  });

  inject(DestroyRef).onDestroy(() => release?.());
}
