import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AppPlatformService } from '../native/app-platform.service';
import { PersistentStore } from '../storage/persistent-store';
import {
  TikTokPixelService,
  TIKTOK_PIXEL_ID,
  TIKTOK_PIXEL_SCRIPT_ID,
} from './tiktok-pixel.service';

describe('TikTokPixelService', () => {
  let routerEvents$: Subject<unknown>;
  let mockRouter: { events: Subject<unknown>; navigated: boolean };
  let mockPlatform: { isNative: boolean };

  beforeEach(() => {
    routerEvents$ = new Subject<unknown>();
    mockRouter = { events: routerEvents$, navigated: false };
    mockPlatform = { isNative: false };

    // Clean up window globals and scripts
    delete (window as unknown as { TiktokAnalyticsObject?: unknown }).TiktokAnalyticsObject;
    delete (window as unknown as { ttq?: unknown }).ttq;
    document.getElementById(TIKTOK_PIXEL_SCRIPT_ID)?.remove();
  });

  afterEach(() => {
    delete (window as unknown as { TiktokAnalyticsObject?: unknown }).TiktokAnalyticsObject;
    delete (window as unknown as { ttq?: unknown }).ttq;
    document.getElementById(TIKTOK_PIXEL_SCRIPT_ID)?.remove();
  });

  function createService(platformId = 'browser'): TikTokPixelService {
    TestBed.configureTestingModule({
      providers: [
        TikTokPixelService,
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: Router, useValue: mockRouter },
        { provide: AppPlatformService, useValue: mockPlatform },
        { provide: PersistentStore, useValue: { get: vi.fn(), set: vi.fn() } },
        { provide: DOCUMENT, useValue: document },
      ],
    });
    return TestBed.inject(TikTokPixelService);
  }

  it('does not initialize on non-browser platform', () => {
    const service = createService('server');
    service.init();
    expect(window.ttq).toBeUndefined();
    expect(document.getElementById(TIKTOK_PIXEL_SCRIPT_ID)).toBeNull();
  });

  it('does not initialize when running natively in Capacitor', () => {
    mockPlatform.isNative = true;
    const service = createService('browser');
    service.init();
    expect(window.ttq).toBeUndefined();
    expect(document.getElementById(TIKTOK_PIXEL_SCRIPT_ID)).toBeNull();
  });

  it('installs the pixel stub and script on web browser', () => {
    const service = createService('browser');
    service.init();

    expect(window.TiktokAnalyticsObject).toBe('ttq');
    expect(window.ttq).toBeDefined();
    expect(typeof window.ttq?.page).toBe('function');
    expect(typeof window.ttq?.track).toBe('function');

    const script = document.getElementById(TIKTOK_PIXEL_SCRIPT_ID) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script?.src).toContain(`sdkid=${TIKTOK_PIXEL_ID}`);
    expect(script?.src).toContain('https://analytics.tiktok.com/i18n/pixel/events.js');
  });

  it('tracks page view on NavigationEnd events', () => {
    const service = createService('browser');
    service.init();

    const initialLength = (window.ttq as unknown[])?.length || 0;

    routerEvents$.next(new NavigationEnd(1, '/test', '/test'));

    // The queued call is pushed to window.ttq array
    const lastItem = (window.ttq as unknown[][])[(window.ttq as unknown[]).length - 1];
    expect(lastItem).toEqual(['page']);
    expect((window.ttq as unknown[]).length).toBe(initialLength + 1);
  });

  it('tracks initial page view if router was already navigated prior to init', () => {
    mockRouter.navigated = true;
    const service = createService('browser');
    service.init();

    const items = window.ttq as unknown[][];
    expect(items.some((item) => Array.isArray(item) && item[0] === 'page')).toBe(true);
  });

  it('delegates track and identify calls to window.ttq', () => {
    const service = createService('browser');
    service.init();

    service.track('CompleteRegistration', { content_name: 'signup' });
    const lastTrack = (window.ttq as unknown[][])[(window.ttq as unknown[]).length - 1];
    expect(lastTrack).toEqual(['track', 'CompleteRegistration', { content_name: 'signup' }, undefined]);

    service.identify({ email: 'user@example.com' });
    const lastIdentify = (window.ttq as unknown[][])[(window.ttq as unknown[]).length - 1];
    expect(lastIdentify).toEqual(['identify', { email: 'user@example.com' }]);
  });

  it('does not re-initialize or inject multiple scripts on repeat init calls', () => {
    const service = createService('browser');
    service.init();
    service.init();

    const scripts = document.querySelectorAll(`script#${TIKTOK_PIXEL_SCRIPT_ID}`);
    expect(scripts.length).toBe(1);
  });
});

