import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RouteScrollRestorationService } from './route-scroll-restoration.service';

describe('RouteScrollRestorationService', () => {
  let events: Subject<NavigationStart | NavigationEnd>;
  let service: RouteScrollRestorationService;
  let scrollElement: HTMLElement;
  let scrollHeight: number;

  beforeEach(() => {
    events = new Subject<NavigationStart | NavigationEnd>();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            events,
            parseUrl: () => ({ fragment: null }),
          },
        },
      ],
    });
    service = TestBed.inject(RouteScrollRestorationService);
    scrollElement = document.createElement('main');
    scrollHeight = 2400;
    Object.defineProperties(scrollElement, {
      clientHeight: { value: 600 },
      scrollHeight: { get: () => scrollHeight },
    });
    service.register(scrollElement);
  });

  afterEach(() => TestBed.resetTestingModule());

  async function renderFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  it('restores an inner shell scroller when navigating back', async () => {
    events.next(new NavigationEnd(1, '/search', '/search'));
    await renderFrame();

    scrollElement.scrollTop = 780;
    events.next(new NavigationStart(2, '/s/example', 'imperative', null));
    events.next(new NavigationEnd(2, '/s/example', '/s/example'));
    await renderFrame();
    expect(scrollElement.scrollTop).toBe(0);

    scrollElement.scrollTop = 120;
    events.next(new NavigationStart(3, '/search', 'popstate', { navigationId: 1 }));
    events.next(new NavigationEnd(3, '/search', '/search'));
    await renderFrame();

    expect(scrollElement.scrollTop).toBe(780);
  });

  it('waits for delayed content instead of abandoning a deep restoration', async () => {
    events.next(new NavigationEnd(1, '/search', '/search'));
    await renderFrame();
    scrollElement.scrollTop = 900;

    events.next(new NavigationStart(2, '/s/example', 'imperative', null));
    events.next(new NavigationEnd(2, '/s/example', '/s/example'));
    await renderFrame();

    scrollHeight = 600;
    events.next(new NavigationStart(3, '/search', 'popstate', { navigationId: 1 }));
    events.next(new NavigationEnd(3, '/search', '/search'));
    await renderFrame();
    expect(scrollElement.scrollTop).toBe(0);

    scrollHeight = 2400;
    scrollElement.append(document.createElement('section'));
    await renderFrame();
    await renderFrame();

    expect(scrollElement.scrollTop).toBe(900);
  });

  it('applies a pending restoration after the inner shell target is registered again', async () => {
    events.next(new NavigationEnd(1, '/search', '/search'));
    await renderFrame();
    scrollElement.scrollTop = 640;

    events.next(new NavigationStart(2, '/about', 'imperative', null));
    service.unregister(scrollElement);
    events.next(new NavigationEnd(2, '/about', '/about'));

    events.next(new NavigationStart(3, '/search', 'popstate', { navigationId: 1 }));
    events.next(new NavigationEnd(3, '/search', '/search'));

    const nextShellTarget = document.createElement('main');
    Object.defineProperties(nextShellTarget, {
      clientHeight: { value: 600 },
      scrollHeight: { value: 2400 },
    });
    service.register(nextShellTarget);
    await renderFrame();

    expect(nextShellTarget.scrollTop).toBe(640);
  });
});
