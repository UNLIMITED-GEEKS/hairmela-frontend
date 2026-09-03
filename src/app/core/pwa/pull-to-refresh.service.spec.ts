import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PullToRefreshService } from './pull-to-refresh.service';
import { InstallPromptService } from './install-prompt.service';
import { AppPlatformService } from '../native/app-platform.service';
import { OverlayRegistry } from '../overlay/overlay-registry';

// Regression cover for the arming rules.
//
// THE BUG THIS EXISTS FOR: pages that scroll a list inside
// `flex-1 overflow-y-auto` (my-position, live-queue, queue-list,
// current-client) leave the SHELL's <main> pinned at scrollTop 0 forever.
// The arm check only consulted that, so it passed on every touch and dragging
// the inner list downward pulled the refresh indicator instead of scrolling
// the list — reported on both iOS standalone and the Android app.
//
// These are unit tests rather than a browser check on purpose: the gesture is
// touch-only AND gated to iOS-standalone/native, so it is invisible in a
// desktop dev browser.
describe('PullToRefreshService', () => {
  let service: PullToRefreshService;
  let overlays: { hasOpen: ReturnType<typeof vi.fn> };

  // The shell's scroll region: h-screen overflow-hidden shell, scroll trapped
  // in an inner <main class="overflow-y-auto">.
  let main: HTMLElement;

  function makeScrollable(el: HTMLElement, { scrollTop = 0, scrolled = true } = {}): void {
    // jsdom has no layout, so scrollHeight/clientHeight are always 0 and
    // getComputedStyle reports whatever we set inline. Both have to be faked.
    el.style.overflowY = 'auto';
    Object.defineProperty(el, 'scrollHeight', { value: scrolled ? 1000 : 100, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  }

  function touch(type: string, target: EventTarget, y = 0, x = 0): TouchEvent {
    const e = new Event(type, { bubbles: true, cancelable: true }) as unknown as TouchEvent;
    Object.defineProperty(e, 'touches', {
      value: [{ clientY: y, clientX: x }],
      configurable: true,
    });
    Object.defineProperty(e, 'target', { value: target, configurable: true });
    return e;
  }

  /** Drive a full downward drag and report whether the pull engaged. */
  function drag(from: EventTarget, distancePx: number): boolean {
    main.dispatchEvent(touch('touchstart', from, 0));
    main.dispatchEvent(touch('touchmove', from, distancePx));
    return service.pullDistance() > 0;
  }

  beforeEach(() => {
    overlays = { hasOpen: vi.fn().mockReturnValue(false) };

    TestBed.configureTestingModule({
      providers: [
        PullToRefreshService,
        // iOS standalone — one of the two platforms that needs the custom
        // gesture, so _needsCustomPull is satisfied and init() wires up.
        { provide: InstallPromptService, useValue: { platform: 'ios', installed: () => true } },
        { provide: AppPlatformService, useValue: { isNative: false } },
        { provide: OverlayRegistry, useValue: overlays },
      ],
    });

    service = TestBed.inject(PullToRefreshService);

    main = document.createElement('main');
    makeScrollable(main, { scrollTop: 0 });
    document.body.appendChild(main);
  });

  afterEach(() => {
    service.teardown();
    main.remove();
  });

  it('arms and pulls when the shell is at the top and nothing is nested', () => {
    const content = document.createElement('div');
    main.appendChild(content);
    service.init({ scrollEl: main });

    expect(drag(content, 40)).toBe(true);
    expect(service.pullState()).toBe('pulling');
  });

  it('does NOT pull when the touch starts in a nested list that is scrolled', () => {
    // The reported bug: inner list mid-scroll, shell's <main> still at 0.
    const list = document.createElement('div');
    makeScrollable(list, { scrollTop: 250 });
    const row = document.createElement('div');
    list.appendChild(row);
    main.appendChild(list);
    service.init({ scrollEl: main });

    expect(drag(row, 40)).toBe(false);
    expect(service.pullState()).toBe('idle');
  });

  it('still pulls when the nested list is at its own top', () => {
    // Genuine overscroll — pulling down from the top of an inner list should
    // refresh, matching the native gesture.
    const list = document.createElement('div');
    makeScrollable(list, { scrollTop: 0 });
    const row = document.createElement('div');
    list.appendChild(row);
    main.appendChild(list);
    service.init({ scrollEl: main });

    expect(drag(row, 40)).toBe(true);
  });

  it('ignores a non-scrollable ancestor and keeps walking up', () => {
    // overflow-y:auto but no overflow to scroll (scrollHeight == clientHeight)
    // is not a scroll container — it must not block the pull.
    const wrapper = document.createElement('div');
    makeScrollable(wrapper, { scrollTop: 0, scrolled: false });
    const row = document.createElement('div');
    wrapper.appendChild(row);
    main.appendChild(wrapper);
    service.init({ scrollEl: main });

    expect(drag(row, 40)).toBe(true);
  });

  it('does not arm when the shell itself is scrolled', () => {
    const content = document.createElement('div');
    main.appendChild(content);
    Object.defineProperty(main, 'scrollTop', { value: 120, writable: true, configurable: true });
    service.init({ scrollEl: main });

    expect(drag(content, 40)).toBe(false);
  });

  it('does not arm while an overlay is open', () => {
    overlays.hasOpen.mockReturnValue(true);
    const content = document.createElement('div');
    main.appendChild(content);
    service.init({ scrollEl: main });

    expect(drag(content, 40)).toBe(false);
  });

  it('does not pull on a horizontal swipe', () => {
    const content = document.createElement('div');
    main.appendChild(content);
    service.init({ scrollEl: main });

    main.dispatchEvent(touch('touchstart', content, 0, 0));
    main.dispatchEvent(touch('touchmove', content, 4, 40));

    expect(service.pullDistance()).toBe(0);
    expect(service.pullState()).toBe('idle');
  });
});
