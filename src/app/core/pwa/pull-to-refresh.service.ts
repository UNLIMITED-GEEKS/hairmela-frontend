import { Injectable, inject, signal } from '@angular/core';
import { InstallPromptService } from './install-prompt.service';
import { AppPlatformService } from '../native/app-platform.service';
import { OverlayRegistry } from '../overlay/overlay-registry';

// Supplies pull-to-refresh for every context EXCEPT the public shell in a
// browser tab.
//
// THE RULE: any shell whose scrolling is trapped in an inner <main> gets the
// custom gesture, on every platform, plus every installed/native context.
// Only the public shell in an ordinary browser tab is left to the browser —
// it scrolls the DOCUMENT, so the native gesture works there and ours would
// double up.
//
// Why each context needs it:
//   - Capacitor APK — a bare WebView: no browser chrome, no native gesture at
//     all, and no service worker in the native build to pick up new content.
//   - iOS standalone — the gesture lives in Safari's chrome, which standalone
//     mode removes entirely.
//   - Android PWA — Chrome's gesture exists but fires on a very short pull;
//     ours is preferred for its longer tuned drag.
//   - Browser tabs, element-scrolled shells — the document never scrolls, so
//     the browser's gesture is either absent (Android) or removed by the
//     document pin that stops iOS rubber-banding (styles.css). Either way
//     there is nothing to double up with.
//
// Wherever the custom gesture runs, the platform's own overscroll is
// suppressed in styles.css so the two can never both fire. Those selectors
// and _needsCustomPull below must stay in step.
//
// We evaluated the cheap fix (display: "minimal-ui" in the manifest, which
// restores the native gesture) and rejected it — it shows a slim browser
// chrome/title bar, and keeping the fully chromeless "native app" look was
// the priority.
//
// THE key structural fact this service is built around: the app's three
// shells do NOT scroll the same way.
//   - auth-shell / guest-shell: h-screen overflow-hidden, with the actual
//     scroll trapped inside an inner <main class="overflow-y-auto">.
//     window.scrollY is ALWAYS 0 there — useless as an "at the top" check.
//   - public-shell: <main class="min-h-screen">, no overflow trap — the
//     WINDOW scrolls normally. window.scrollY is the correct, and only,
//     signal there.
// So this service supports two scroll-source modes (see PullToRefreshConfig)
// rather than assuming one.
export type PullState = 'idle' | 'pulling' | 'ready' | 'refreshing';

export interface PullToRefreshConfig {
  /** Element-scrolled shells (auth/guest) — pass the shell's inner <main>. */
  scrollEl?: HTMLElement;
  /** Window-scrolled shells (public) — true instead of an element. */
  window?: boolean;
}

const PULL_THRESHOLD_PX = 190;
// How far the RESISTED drag must get before the indicator is revealed at all.
// Separate from PULL_THRESHOLD_PX, which is when the pull would actually fire.
//
// WHY IT EXISTS: 'pulling' used to be set the moment the axis lock resolved to
// vertical — 8px of finger travel — so the arrow flashed up during ordinary
// scrolling and short flicks. Holding it back until the drag is deliberate
// keeps the gesture available without the indicator appearing on every touch.
//
// In resisted pixels like the threshold above, so at RESISTANCE_FACTOR 0.35
// this is ~371px of actual finger travel before anything is shown, with
// another ~171px of visible drag before it reaches PULL_THRESHOLD_PX and
// would fire.
const PULL_REVEAL_PX = 130;
// Resistance so the drag feels progressively "heavier" past the threshold,
// the standard native-feeling pull-to-refresh behavior — a raw 1:1 drag
// feels wrong once you're well past what's needed to trigger a refresh.
const RESISTANCE_FACTOR = 0.35;
// How far a touch must travel before we decide whether it is a vertical pull
// or a horizontal scroll. Small enough to feel instant, large enough that the
// first pixel or two of thumb wobble does not pick the axis for the user.
const AXIS_LOCK_SLOP_PX = 8;

@Injectable({ providedIn: 'root' })
export class PullToRefreshService {
  private readonly _install = inject(InstallPromptService);
  private readonly _platform = inject(AppPlatformService);
  private readonly _overlays = inject(OverlayRegistry);

  private readonly _pullState = signal<PullState>('idle');
  private readonly _pullDistance = signal(0);

  readonly pullState = this._pullState.asReadonly();
  readonly pullDistance = this._pullDistance.asReadonly();

  private _config: PullToRefreshConfig | null = null;
  private _target: HTMLElement | Window | null = null;
  private _startY = 0;
  private _startX = 0;
  // Locked on first meaningful movement, so a gesture cannot switch axis
  // mid-swipe — see _handleTouchMove.
  private _axis: 'undecided' | 'vertical' | 'horizontal' = 'undecided';
  private _armed = false;

  // Bound once so add/removeEventListener reference the same function.
  private readonly _onTouchStart = (e: TouchEvent) => this._handleTouchStart(e);
  private readonly _onTouchMove = (e: TouchEvent) => this._handleTouchMove(e);
  private readonly _onTouchEnd = () => this._handleTouchEnd();

  /**
   * Whether THIS shell, on THIS platform, should run the custom gesture.
   *
   *   Capacitor APK  — a bare WebView: no browser chrome, no native gesture,
   *                    so it needs one everywhere.
   *   Installed app (iOS standalone OR Android PWA) — every shell. iOS
   *                    standalone has no gesture at all (it lives in Safari's
   *                    chrome). The Android PWA does have Chrome's, but it
   *                    fires on a very short pull; ours is used instead for a
   *                    deliberately longer, tuned drag (PULL_REVEAL_PX /
   *                    PULL_THRESHOLD_PX). Chrome's is suppressed in
   *                    styles.css so the two cannot both fire.
   *   iOS browser TAB, element-scrolled shells only — those shells trap
   *                    scrolling in an inner <main>, so the document is pinned
   *                    to stop it rubber-banding (styles.css). On iOS the
   *                    bounce and the browser's pull-to-refresh are the same
   *                    gesture, so pinning takes the refresh with it — this
   *                    puts one back.
   *
   * Deliberately NOT the PUBLIC SHELL in a browser tab: it scrolls the document
   * itself, so the browser's own gesture works there and is left alone. Adding
   * ours on top would double up.
   */
  private _needsCustomPull(config: PullToRefreshConfig): boolean {
    if (this._platform.isNative) return true;
    if (this._install.installed()) return true;
    // Browser tab, either platform: only the element-scrolled shells, where the
    // document does not scroll and the browser's gesture is unhelpful anyway.
    return !config.window;
  }

  // Called by each shell (auth-shell, guest-shell, public-shell) once its
  // scroll region is available. Safe to call again on shell re-entry/switch —
  // tears down any previous listeners first, since switching shells (e.g.
  // public -> log in -> auth) also switches the scroll source from window to
  // element, and a stale listener on the old target must not linger.
  init(config: PullToRefreshConfig): void {
    this.teardown();

    // Tell CSS which scroll model the mounted shell uses. Set BEFORE the
    // _needsCustomPull bail-out below, because it is needed even where the
    // custom gesture never runs (an iOS browser tab).
    //
    // WHY IT EXISTS: iOS rubber-bands the document when the body has nothing
    // to scroll, which is the auth/guest shells' shape (scrolling is trapped
    // in an inner <main class="overflow-y-auto">). Pinning the body stops
    // that — but the public shell scrolls the DOCUMENT itself
    // (<main class="min-h-screen">), so the same rule froze those pages
    // outright. The lock is therefore keyed off the shell, not the platform.
    document.documentElement.classList.toggle('hm-inner-scroll', !config.window);

    // Takes the incoming config rather than reading this._config, which is not
    // assigned until below — the decision now depends on the shell's scroll
    // model, not just the platform.
    if (!this._needsCustomPull(config)) return;

    this._config = config;
    this._target = config.window ? window : (config.scrollEl ?? null);
    if (!this._target) return;

    // touchstart is passive (we never preventDefault it). touchmove is
    // deliberately NOT passive: once the gesture is confirmed as a downward
    // pull we call preventDefault() to stop the platform's own overscroll
    // (iOS rubber-band, Android WebView glow/stretch) fighting the drag. This
    // is the one documented exception to "listeners should be passive" here.
    //
    // Crucially, preventDefault() is reached ONLY after the axis lock resolves
    // to 'vertical' — every earlier path returns untouched. That is what lets
    // horizontal strips (category pills, salon card rows) scroll normally
    // instead of being swallowed by a refresh that was never intended.
    this._target.addEventListener('touchstart', this._onTouchStart as EventListener, { passive: true });
    this._target.addEventListener('touchmove', this._onTouchMove as EventListener, { passive: false });
    this._target.addEventListener('touchend', this._onTouchEnd, { passive: true });
    this._target.addEventListener('touchcancel', this._onTouchEnd, { passive: true });
  }

  teardown(): void {
    if (this._target) {
      this._target.removeEventListener('touchstart', this._onTouchStart as EventListener);
      this._target.removeEventListener('touchmove', this._onTouchMove as EventListener);
      this._target.removeEventListener('touchend', this._onTouchEnd);
      this._target.removeEventListener('touchcancel', this._onTouchEnd);
    }
    this._target = null;
    this._config = null;
    this._armed = false;
    this._axis = 'undecided';
    this._pullState.set('idle');
    this._pullDistance.set(0);
    // Dropped here rather than left for the next init() to overwrite: a shell
    // can unmount without another mounting straight away, and a stale
    // inner-scroll flag would pin the body on a page that scrolls itself.
    document.documentElement.classList.remove('hm-inner-scroll');
  }

  private _currentScrollTop(): number {
    if (this._config?.window) return window.scrollY;
    return this._config?.scrollEl?.scrollTop ?? 0;
  }

  /**
   * True when the touch began inside a NESTED scroll container that is not at
   * its own top.
   *
   * WHY: _currentScrollTop() only sees the shell's own scroll source. Pages
   * that scroll a list inside `flex-1 overflow-y-auto` (my-position,
   * live-queue, queue-list, current-client) leave the shell's <main> pinned at
   * scrollTop 0 forever, so the arm check passed on every touch and dragging
   * the inner list downward pulled the refresh indicator instead of scrolling
   * the list.
   *
   * Walks from the touch target up to the shell's scroll element (or <body>
   * for the window-scrolled shell), stopping at the first vertically
   * scrollable ancestor. Only that innermost one matters — it is what the
   * browser will actually scroll with this gesture.
   *
   * Returns false when such a container IS at its own top: pulling down from
   * the top of an inner list is genuinely an overscroll, and letting it refresh
   * matches what the native gesture does.
   */
  private _startedInScrolledNestedContainer(target: EventTarget | null): boolean {
    const boundary = this._config?.window ? document.body : this._config?.scrollEl;
    let el = target instanceof Element ? target : null;

    while (el && el !== boundary) {
      const style = getComputedStyle(el);
      const overflowY = style.overflowY;
      const scrollable =
        (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
      // First scrollable ancestor wins — anything above it will not move.
      if (scrollable) return el.scrollTop > 0;
      el = el.parentElement;
    }
    return false;
  }

  private _handleTouchStart(e: TouchEvent): void {
    if (this._pullState() === 'refreshing') return;
    // A modal/dialog is open — never arm underneath it. Swiping down to
    // dismiss a sheet is a native-app reflex, and without this that gesture
    // reloads the whole app and discards in-progress state (a half-filled
    // booking form being the worst case). Checked at ARM time so the drag
    // never starts, rather than at commit time where the indicator would
    // already have been dragged down and then do nothing.
    if (this._overlays.hasOpen()) {
      this._armed = false;
      return;
    }
    // Only arm if we're already at the very top of THIS shell's scroll
    // source — a touch starting mid-scroll must never arm the page-level pull.
    if (this._currentScrollTop() > 0) {
      this._armed = false;
      return;
    }
    // ...and not if the touch began inside a nested scroll container that has
    // been scrolled. The shell's own scrollTop stays 0 on those pages, so
    // without this the check above always passed and scrolling an inner list
    // dragged the refresh indicator.
    if (this._startedInScrolledNestedContainer(e.target)) {
      this._armed = false;
      return;
    }
    this._armed = true;
    this._startY = e.touches[0].clientY;
    this._startX = e.touches[0].clientX;
    this._axis = 'undecided';
  }


  private _handleTouchMove(e: TouchEvent): void {
    if (!this._armed) return;

    const delta = e.touches[0].clientY - this._startY;
    const deltaX = e.touches[0].clientX - this._startX;

    // AXIS LOCK. Decide once, on the first movement that clears the slop
    // threshold, whether this gesture is a vertical pull or a horizontal
    // scroll — then stick with it for the rest of the touch.
    //
    // Without this, swiping a horizontal strip (the category pills, the salon
    // card row) triggered a refresh: no thumb swipe is perfectly horizontal,
    // so the small downward drift read as a pull, and preventDefault() below
    // then killed the horizontal scroll outright.
    if (this._axis === 'undecided') {
      const absY = Math.abs(delta);
      const absX = Math.abs(deltaX);
      if (Math.max(absX, absY) < AXIS_LOCK_SLOP_PX) return; // too early to tell
      this._axis = absX > absY ? 'horizontal' : 'vertical';
    }

    // Horizontal gesture — hands off entirely, including preventDefault, so
    // the strip scrolls normally.
    if (this._axis === 'horizontal') {
      this._pullState.set('idle');
      this._pullDistance.set(0);
      return;
    }

    if (delta <= 0) {
      // Dragging back up (or no movement) — not a pull; let the browser
      // handle it normally instead of holding the gesture hostage.
      this._pullState.set('idle');
      this._pullDistance.set(0);
      return;
    }
    // Confirmed downward drag from the top — this is the point we take over
    // from the browser's own overscroll/rubber-band handling.
    //
    // preventDefault() happens BEFORE the reveal check below on purpose: the
    // gesture is owned from here regardless of whether anything is drawn yet.
    // Letting the page scroll during the pre-reveal part and only taking over
    // at the reveal point would make the content jump the moment the arrow
    // appeared.
    e.preventDefault();
    const resisted = delta * RESISTANCE_FACTOR;

    // Below the reveal point the drag is tracked but nothing is shown — see
    // PULL_REVEAL_PX. Distance is held at 0 so the indicator does not animate
    // in from a partial offset the instant it crosses.
    if (resisted < PULL_REVEAL_PX) {
      this._pullState.set('idle');
      this._pullDistance.set(0);
      return;
    }

    // Reported MINUS the reveal offset, so the indicator grows from zero at
    // the moment it appears rather than popping in already 40px down. The
    // fire threshold below still compares the RAW resisted distance, so
    // PULL_REVEAL_PX changes when the arrow shows up without also changing
    // how far the pull has to go to actually refresh.
    this._pullDistance.set(resisted - PULL_REVEAL_PX);
    this._pullState.set(resisted >= PULL_THRESHOLD_PX ? 'ready' : 'pulling');
  }

  private _handleTouchEnd(): void {
    if (!this._armed) return;
    this._armed = false;
    // Reset before any early return below — a lingering 'horizontal' lock
    // would suppress the next gesture's pull entirely.
    const axis = this._axis;
    this._axis = 'undecided';
    if (axis === 'horizontal') {
      this._pullState.set('idle');
      this._pullDistance.set(0);
      return;
    }
    if (this._pullState() === 'ready') {
      this._pullState.set('refreshing');
      // The former FIXME here — "pull-to-refresh is not suppressed while a
      // modal is open, because there is no shared is-any-modal-open signal" —
      // is now fixed at the arming check in _handleTouchStart(), using the
      // OverlayRegistry built for the Android back button. All seven dialogs
      // register there, so the gesture can no longer reload the app out from
      // under an open modal.
      //
      // reload() is correct on native too: the WebView reloads from the
      // bundled assets (fast, no network), which re-runs bootstrap and
      // re-fetches app data — exactly the intent. It does NOT pick up a new
      // app version; that requires a Play Store update.
      window.location.reload();
      return;
    }
    this._pullState.set('idle');
    this._pullDistance.set(0);
  }
}
