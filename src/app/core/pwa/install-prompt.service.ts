import { Injectable, inject, signal } from '@angular/core';
import { PersistentStore } from '../storage/persistent-store';

// Chrome/Edge/Samsung Internet fire this on window before showing their own
// install UI. Calling preventDefault() suppresses that UI so we can show our
// own button and call .prompt() later. Not in lib.dom.d.ts — Apple/Firefox
// never implemented it, so TypeScript has no built-in type for it.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type Platform = 'android' | 'ios' | 'desktop';

const INSTALLED_KEY = 'hm_pwa_installed';

// Detects install capability/state across platforms so the how-to-install
// page can show the right section per visitor instead of generic instructions.
//
// Android/Chromium: beforeinstallprompt is the only source of truth for "can
// install right now" — there's no other way to ask. It may never fire (already
// installed, browser doesn't support it, or the user dismissed it enough times
// that Chrome stops offering it) — callers must have a manual-steps fallback
// for that case, not assume the event always arrives.
//
// iOS Safari: no beforeinstallprompt exists at all (Apple never implemented
// it) — Add to Home Screen is a manual, Safari-only Share Sheet action.
// navigator.standalone is Safari's own (non-standard) way of reporting "the
// user already did this and is running from the home screen icon."
@Injectable({ providedIn: 'root' })
export class InstallPromptService {
  private readonly _store = inject(PersistentStore);

  private _deferredPrompt: BeforeInstallPromptEvent | null = null;

  // True once beforeinstallprompt has fired — the one-click Install button
  // should only render after this flips, never optimistically.
  readonly canPromptInstall = signal(false);
  readonly installed = signal(this._detectInstalled());

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._deferredPrompt = e as BeforeInstallPromptEvent;
      this.canPromptInstall.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this._store.set(INSTALLED_KEY, true);
      this.installed.set(true);
      this.canPromptInstall.set(false);
      this._deferredPrompt = null;
    });
  }

  readonly platform: Platform = this._detectPlatform();

  /** True only on iOS Safari itself — the one browser that can add to home screen. */
  readonly isIosSafari: boolean = this._detectIosSafari();

  /** Triggers the native install prompt. No-op if none is pending. */
  async promptInstall(): Promise<void> {
    if (!this._deferredPrompt) return;
    await this._deferredPrompt.prompt();
    const { outcome } = await this._deferredPrompt.userChoice;
    this._deferredPrompt = null;
    this.canPromptInstall.set(false);
    if (outcome === 'accepted') {
      this._store.set(INSTALLED_KEY, true);
      this.installed.set(true);
    }
  }

  private _detectPlatform(): Platform {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    // iPadOS 13+ reports as "Macintosh" but exposes touch support — the
    // standard sniff every install-prompt library uses to still catch iPads.
    if (/iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) {
      return 'ios';
    }
    return 'desktop';
  }

  private _detectIosSafari(): boolean {
    const ua = navigator.userAgent;
    // Every non-Safari iOS browser is WebKit-in-a-different-shell and stamps
    // its own token (CriOS, FxiOS, EdgiOS, ...) alongside "Safari" in the UA —
    // so "Safari" AND none of those tokens is what actually means Safari itself.
    const isSafariUa = /safari/i.test(ua) && !/crios|fxios|edgios|opios|opt\/|duckduckgo/i.test(ua);
    return this._detectPlatform() === 'ios' && isSafariUa;
  }

  private _detectInstalled(): boolean {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if ((navigator as { standalone?: boolean }).standalone === true) return true;
    return this._store.get<boolean>(INSTALLED_KEY) === true;
  }
}
