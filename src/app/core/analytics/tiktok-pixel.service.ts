import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AppPlatformService } from '../native/app-platform.service';
import { PersistentStore } from '../storage/persistent-store';

export const TIKTOK_PIXEL_ID = 'DBBMEDJC77UASCMGCQF0';
export const TIKTOK_PIXEL_SCRIPT_ID = 'hm-tiktok-pixel';

interface TikTokPixelQueue {
  methods: string[];
  setAndDefer: (target: unknown, method: string) => void;
  instance: (name: string) => unknown;
  load: (pixelId: string, options?: unknown) => void;
  page: () => void;
  track: (event: string, properties?: Record<string, unknown>, options?: Record<string, unknown>) => void;
  identify: (options: Record<string, unknown>) => void;
  [key: string]: unknown;
}

declare global {
  interface Window {
    TiktokAnalyticsObject?: string;
    ttq?: TikTokPixelQueue & unknown[];
  }
}

@Injectable({ providedIn: 'root' })
export class TikTokPixelService {
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

  track(event: string, properties?: Record<string, unknown>, options?: Record<string, unknown>): void {
    window.ttq?.track(event, properties, options);
  }

  identify(options: Record<string, unknown>): void {
    window.ttq?.identify(options);
  }

  private _installPixel(): void {
    const win = window as Window & typeof globalThis;
    const doc = this._document;
    const t = 'ttq';

    win.TiktokAnalyticsObject = t;
    const ttq: any = (win.ttq = (win.ttq || []) as any);

    if (!ttq.methods) {
      ttq.methods = [
        'page',
        'track',
        'identify',
        'instances',
        'debug',
        'on',
        'off',
        'once',
        'ready',
        'alias',
        'group',
        'enableCookie',
        'disableCookie',
        'holdConsent',
        'revokeConsent',
        'grantConsent',
      ];

      ttq.setAndDefer = (target: any, method: string) => {
        target[method] = (...args: unknown[]) => {
          target.push([method, ...args]);
        };
      };

      for (let i = 0; i < ttq.methods.length; i++) {
        ttq.setAndDefer(ttq, ttq.methods[i]);
      }

      ttq.instance = (instanceId: string) => {
        const instance = (ttq as any)._i?.[instanceId] || [];
        for (let n = 0; n < ttq.methods.length; n++) {
          ttq.setAndDefer(instance, ttq.methods[n]);
        }
        return instance;
      };

      ttq.load = (pixelId: string, options?: any) => {
        const scriptUrl = 'https://analytics.tiktok.com/i18n/pixel/events.js';
        (ttq as any)._i = (ttq as any)._i || {};
        (ttq as any)._i[pixelId] = [];
        (ttq as any)._i[pixelId]._u = scriptUrl;
        (ttq as any)._t = (ttq as any)._t || {};
        (ttq as any)._t[pixelId] = +new Date();
        (ttq as any)._o = (ttq as any)._o || {};
        (ttq as any)._o[pixelId] = options || {};

        if (!doc.getElementById(TIKTOK_PIXEL_SCRIPT_ID)) {
          const script = doc.createElement('script');
          script.id = TIKTOK_PIXEL_SCRIPT_ID;
          script.type = 'text/javascript';
          script.async = true;
          script.src = `${scriptUrl}?sdkid=${pixelId}&lib=${t}`;
          const firstScript = doc.getElementsByTagName('script')[0];
          if (firstScript && firstScript.parentNode) {
            firstScript.parentNode.insertBefore(script, firstScript);
          } else {
            doc.head.appendChild(script);
          }
        }
      };
    }

    win.ttq?.load(TIKTOK_PIXEL_ID);
  }

  private _trackPageView(): void {
    window.ttq?.page();
  }
}
