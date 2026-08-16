import { Injectable, inject, signal } from '@angular/core';
import { InstallPromptService } from './install-prompt.service';
import { AppPlatformService } from '../native/app-platform.service';
import { OverlayRegistry } from '../overlay/overlay-registry';

// Supplies pull-to-refresh wherever the platform does not. Two such places:
//
//   1. iOS home-screen standalone PWA — the gesture lives in Safari's browser
//      chrome, which standalone mode removes entirely.
//   2. The Capacitor Android app — a bare WebView with no browser chrome and
//      no built-in overscroll refresh, so without this there is NO way to
//      refresh at all (there is also no service worker in the native build to
//      pick up new content).
//
// Android's *installed PWA* keeps its own native gesture and is deliberately
// still excluded — adding ours there would double up on the browser's.
//
// We evaluated the cheap fix (display: "minimal-ui" in the manifest, which
// restores the native gesture) and rejected it — it shows a slim browser
// chrome/title bar, and keeping the fully chromeless "native app" look was
// the priority. Hence: a custom touch gesture, iOS-standalone-only.
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

const PULL_THRESHOLD_PX = 180;
// Resistance so the drag feels progressively "heavier" past the threshold,
// the standard native-feeling pull-to-refresh behavior — a raw 1:1 drag
// feels wrong once you're well past what's needed to trigger a refresh.
const RESISTANCE_FACTOR = 0.35;

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
  private _armed = false;

  // Bound once so add/removeEventListener reference the same function.
  private readonly _onTouchStart = (e: TouchEvent) => this._handleTouchStart(e);
  private readonly _onTouchMove = (e: TouchEvent) => this._handleTouchMove(e);
  private readonly _onTouchEnd = () => this._handleTouchEnd();

  private get _isIosStandalone(): boolean {
    return this._install.platform === 'ios' && this._install.installed();
  }

  /** Platforms with no pull-to-refresh of their own — see the class doc. */
  private get _needsCustomPull(): boolean {
    return this._platform.isNative || this._isIosStandalone;
  }

  // Called by each shell (auth-shell, guest-shell, public-shell) once its
  // scroll region is available. Safe to call again on shell re-entry/switch —
  // tears down any previous listeners first, since switching shells (e.g.
  // public -> log in -> auth) also switches the scroll source from window to
  // element, and a stale listener on the old target must not linger.
  init(config: PullToRefreshConfig): void {
    this.teardown();
    if (!this._needsCustomPull) return;

    this._config = config;
    this._target = config.window ? window : (config.scrollEl ?? null);
    if (!this._target) return;

    // touchstart is passive (we never preventDefault it — only an armed
    // touchmove needs that). touchmove is deliberately NOT passive: once
    // armed, we call preventDefault() to stop the platform's own overscroll
    // (iOS rubber-band, Android WebView glow/stretch) from fighting the
    // custom drag. This is the one documented exception to "listeners should
    // be passive" in this codebase.
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
    this._pullState.set('idle');
    this._pullDistance.set(0);
  }

  private _currentScrollTop(): number {
    if (this._config?.window) return window.scrollY;
    return this._config?.scrollEl?.scrollTop ?? 0;
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
    // source — a touch starting mid-scroll (or mid-scroll of a nested
    // overflow-y-auto list, which has its own independent scrollTop this
    // check never looks at) must never arm the page-level pull.
    if (this._currentScrollTop() > 0) {
      this._armed = false;
      return;
    }
    this._armed = true;
    this._startY = e.touches[0].clientY;
  }

  private _handleTouchMove(e: TouchEvent): void {
    if (!this._armed) return;
    const delta = e.touches[0].clientY - this._startY;
    if (delta <= 0) {
      // Dragging back up (or no movement) — not a pull; let the browser
      // handle it normally instead of holding the gesture hostage.
      this._pullState.set('idle');
      this._pullDistance.set(0);
      return;
    }
    // Confirmed downward drag from the top — this is the point we take over
    // from the browser's own overscroll/rubber-band handling.
    e.preventDefault();
    const resisted = delta * RESISTANCE_FACTOR;
    this._pullDistance.set(resisted);
    this._pullState.set(resisted >= PULL_THRESHOLD_PX ? 'ready' : 'pulling');
  }

  private _handleTouchEnd(): void {
    if (!this._armed) return;
    this._armed = false;
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
