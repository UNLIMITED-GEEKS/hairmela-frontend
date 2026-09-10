import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AppPlatformService } from '../native/app-platform.service';
import { PersistentStore } from '../storage/persistent-store';

export const COOKIE_CONSENT_KEY = 'hm_cookie_consent';
export type CookieChoice = 'accepted' | 'rejected';

const META_PIXEL_ID = '1551880192804918';
const META_PIXEL_SCRIPT_ID = 'hm-meta-pixel';

interface MetaPixelFunction {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  loaded: boolean;
  version: string;
}

declare global {
  interface Window {
    fbq?: MetaPixelFunction;
    _fbq?: MetaPixelFunction;
  }
}

@Injectable({ providedIn: 'root' })
export class MetaPixelService {
  private readonly _document = inject(DOCUMENT);
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _router = inject(Router);
  private readonly _store = inject(PersistentStore);
  private readonly _appPlatform = inject(AppPlatformService);
  private readonly _destroyRef = inject(DestroyRef);
  private _initialized = false;

  initIfConsented(): void {
    // if (this._store.get<CookieChoice>(COOKIE_CONSENT_KEY) !== 'accepted') return;
    this.init();
  }

  init(): void {
    if (this._initialized || !isPlatformBrowser(this._platformId) || this._appPlatform.isNative) {
      return;
    }

    this._initialized = true;
    this._installPixel();

    // During boot, the initial NavigationEnd supplies the first PageView. If
    // consent is granted after navigation, track the page already on screen.
    if (this._router.navigated) this._trackPageView();
    this._router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => this._trackPageView());
  }

  private _installPixel(): void {
    if (!window.fbq) {
      const fbq = ((...args: unknown[]) => {
        if (fbq.callMethod) fbq.callMethod(...args);
        else fbq.queue.push(args);
      }) as MetaPixelFunction;
      fbq.queue = [];
      fbq.loaded = true;
      fbq.version = '2.0';
      window.fbq = fbq;
      window._fbq = fbq;
    }

    if (!this._document.getElementById(META_PIXEL_SCRIPT_ID)) {
      const script = this._document.createElement('script');
      script.id = META_PIXEL_SCRIPT_ID;
      script.async = true;
      script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      this._document.head.appendChild(script);
    }

    window.fbq?.('init', META_PIXEL_ID);
  }

  private _trackPageView(): void {
    window.fbq?.('track', 'PageView');
  }
}
