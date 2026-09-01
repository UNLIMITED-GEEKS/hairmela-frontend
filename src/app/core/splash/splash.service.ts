import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, afterNextRender, inject } from '@angular/core';

/**
 * How long the splash holds before it starts fading. The logo drop and letter
 * cascade finish at ~1.15s, so this clears the animation with a short beat to
 * read it — and no more. This screen is shown on EVERY launch, where a wait
 * the user notices is a wait that annoys them.
 */
const HOLD_MS = 1150;
/** Must match the transition-duration on #hm-splash in index.html. */
const FADE_MS = 300;
/**
 * Grace period before the element is removed. The transition cannot start on
 * the same tick the class is added — the browser has not painted the new
 * opacity yet — so removing at exactly FADE_MS clipped the fade and the splash
 * appeared to vanish rather than dissolve.
 */
const FADE_GRACE_MS = 80;

/**
 * Owns the boot splash declared in index.html.
 *
 * WHY THE MARKUP IS NOT A COMPONENT: it has to be on screen for the very first
 * frame the browser paints, and a component cannot be — Angular must download,
 * parse and bootstrap first, which is precisely the blank gap the splash
 * covers. So index.html renders it and this service only takes it away.
 *
 * IT NEVER BLOCKS ANYTHING. The splash is a fixed overlay on its own layer:
 * Angular boots, guards run and the dashboard's requests all proceed
 * underneath while it is visible. The intent is that by the time it clears,
 * the data has arrived and the user never sees a skeleton — but nothing waits
 * on it, and it is capped at HOLD_MS whether loading finished or not. A slow
 * network must never leave someone staring at a logo.
 *
 * TWO AUDIENCES, DECIDED IN DIFFERENT PLACES:
 *
 *   Installed app — index.html's boot script reveals it synchronously, since
 *   "am I standalone?" is answerable before Angular exists.
 *
 *   Web — hidden by default and opted into by showForDashboard() alone. It
 *   cannot be decided pre-boot: it depends on the user being signed in AND
 *   heading for the dashboard, and a refresh token sitting in storage proves
 *   neither (it may be expired, landing them on login instead). Putting a
 *   launch animation in front of the marketing page, or in front of someone
 *   about to be shown a login form, is worse than no splash at all.
 */
@Injectable({ providedIn: 'root' })
export class SplashService {
  private readonly _document = inject(DOCUMENT);
  private readonly _injector = inject(Injector);

  // Guards the exit TIMER only. Deliberately not a "splash is finished" flag:
  // dismiss() and showForDashboard() are both driven by app initializers, which
  // Angular runs in PARALLEL — dismiss() lands first because it is synchronous
  // while sessionInit awaits hydration and a network refresh. If revealing
  // checked this flag, the web splash could never appear.
  private _exitScheduled = false;
  private _removed = false;

  /**
   * Android's fade-in: release the class that is holding app-root at opacity 0.
   *
   * WAITS FOR THE FIRST NAVIGATION TO RENDER. dismiss() runs from an app
   * initializer, which is before the router has painted a route — fading in
   * there shows a blank page and the real content then appears behind it with
   * nothing left to animate. That was also why the earlier readystatechange
   * version failed: document 'complete' is even earlier.
   *
   * afterNextRender is the actual "something has been painted" guarantee, and
   * it is a no-op on the server.
   */
  private _fadeInApp(): void {
    const root = this._document.documentElement;
    const view = this._document.defaultView;
    if (!view) return;
    afterNextRender(
      () => {
        view.requestAnimationFrame(() => {
          root.classList.add('hm-splash-leaving');
          view.setTimeout(
            () => root.classList.remove('hm-splash-showing', 'hm-splash-leaving'),
            FADE_MS + FADE_GRACE_MS,
          );
        });
      },
      { injector: this._injector },
    );
  }

  /**
   * Holds app-root at opacity 0 while the splash covers it, so the app can
   * fade UP as the splash fades down (see index.html).
   *
   * FOR THE WEB PATH ONLY IN PRACTICE. In an installed app index.html sets this
   * class pre-boot, alongside revealing the splash — it has to, because by the
   * time this service runs (an app initializer) app-root has already painted,
   * and hiding it then produces a flash rather than a fade. On the web the
   * reveal genuinely is a post-boot decision (showForDashboard), so the class
   * is set here. Idempotent either way.
   */
  private _markShowing(): void {
    if (this._el?.hidden) return;
    this._document.documentElement.classList.add('hm-splash-showing');
  }

  private get _el(): HTMLElement | null {
    return this._document.getElementById('hm-splash');
  }

  /** True when index.html's boot script decided this is an installed app. */
  get isVisible(): boolean {
    const el = this._el;
    return !!el && !el.hidden;
  }

  /**
   * Web only: show the splash over a dashboard that is about to load, for a
   * signed-in visitor who was redirected there. No-op in an installed app,
   * where the splash is already up from the first frame.
   */
  showForDashboard(): void {
    const el = this._el;
    if (!el || this._removed) return;
    el.hidden = false;
    this._markShowing();
    // RESTART the clock from here, don't just join the one dismiss() began at
    // boot. sessionInit awaits hydration and a network token refresh before
    // calling this, which on a real connection is several hundred ms — so a
    // hold measured from boot would have most of itself already spent, the
    // splash would flash briefly, and the dashboard would render underneath
    // while it was still fading. The hold must run from when the splash became
    // VISIBLE.
    this._exitScheduled = false;
    this.dismiss();
  }

  /**
   * Hold, fade, then REMOVE the element — not merely hide it. A transparent
   * fixed overlay left in the tree would swallow every click on the page
   * underneath it.
   *
   * Idempotent: both the app-context path and showForDashboard() call it, and
   * a second call must not restart the timer.
   */
  dismiss(): void {
    if (this._exitScheduled) return;
    this._exitScheduled = true;

    const el = this._el;
    if (!el) return;
    // Nothing to fade if this launch never revealed it — the ordinary web case,
    // where dismiss() runs from the app initializer but the splash stays
    // hidden. Returning here leaves showForDashboard() free to start a real
    // hold later if this turns out to be the dashboard redirect.
    if (el.hidden) {
      // ANDROID: index.html sets hm-splash-showing (app-root held at opacity 0)
      // but never reveals #hm-splash, because the system splash is that
      // launch's only splash. There is no element to fade — just the class to
      // release, and it must happen HERE rather than from a readystatechange
      // listener in index.html, because document 'complete' fires while the
      // WebView still holds an empty shell. Releasing it then faded in a blank
      // page and the real content snapped in afterwards.
      const root = this._document.documentElement;
      if (root.classList.contains('hm-splash-showing')) {
        this._fadeInApp();
        return;
      }
      // Ordinary web visit: dismiss() runs from the app initializer but the
      // splash stays hidden. Resetting the guard leaves showForDashboard() free
      // to start a real hold later if this turns out to be the redirect.
      this._exitScheduled = false;
      return;
    }
    // AFTER the hidden check, so a plain web visit never dims app-root with no
    // splash in front of it.
    this._markShowing();

    const view = this._document.defaultView;
    if (!view) return;

    view.setTimeout(() => {
      // Next frame, so the browser has painted the element at full opacity
      // before the class flips it to 0. Adding the class in the same tick as
      // the element became visible gives no start state to animate FROM, and
      // the transition is skipped entirely.
      view.requestAnimationFrame(() => {
        el.classList.add('hm-splash-out');
        // Cross-fade: the app fades UP on the same frame the splash fades down,
        // so the two overlap instead of the content snapping in behind.
        this._document.documentElement.classList.add('hm-splash-leaving');
        // Timer rather than a transitionend listener: transitionend never fires
        // if the element is not rendered (a backgrounded tab, reduced-motion
        // collapsing the duration), and the splash would then be stranded on
        // screen forever. A timer always resolves.
        view.setTimeout(() => {
          this._removed = true;
          el.remove();
          // Drop both classes once the element is gone: leaving them would pin
          // an inline-less opacity transition on app-root for the rest of the
          // session, which then animates on any later reflow.
          const root = this._document.documentElement;
          root.classList.remove('hm-splash-showing', 'hm-splash-leaving');
        }, FADE_MS + FADE_GRACE_MS);
      });
    }, HOLD_MS);
  }
}
