import { Component, computed, signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { RestoreListingScrollDirective } from './restore-listing-scroll.directive';
import { LastViewedSalonService } from '../../core/scroll/last-viewed-salon.service';

// A real host with real cards, rather than hand-built DOM: the directive finds
// its target via [data-salon-id] inside its own host element, so the structure
// it walks has to be the structure Angular actually renders.
@Component({
  selector: 'app-host',
  imports: [RestoreListingScrollDirective],
  template: `
    <div appRestoreListingScroll [surface]="surface()" [items]="cards()" style="overflow-x: auto">
      @for (id of items(); track id) {
        <div [attr.data-salon-id]="id">{{ id }}</div>
      }
    </div>
  `,
})
class HostComponent {
  readonly items = signal<string[]>([]);
  // The directive takes the list itself; the host still drives ids for the DOM.
  readonly cards = computed(() => this.items().map((id) => ({ id })));
  readonly surface = signal<'search' | 'landing'>('search');
}

describe('RestoreListingScrollDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let lastViewed: LastViewedSalonService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    lastViewed = TestBed.inject(LastViewedSalonService);
  });

  // afterNextRender fires right after the render that creates the cards, so
  // stubbing a card AFTER detectChanges() is too late — the callback has
  // already measured. These install the stub on the prototype BEFORE that
  // render, keyed by id, so every card gets it the moment Angular creates it.
  const scrollSpies = new Map<string, (arg?: unknown) => void>();
  const rects = new Map<string, DOMRect>();

  // Outside the container box on BOTH axes (see containerRect below), so the
  // directive treats it as needing a scroll.
  function offScreenRect(): DOMRect {
    return { top: 5000, bottom: 5200, left: 900, right: 1100 } as DOMRect;
  }
  function onScreenRect(): DOMRect {
    return { top: 10, bottom: 200, left: 10, right: 100 } as DOMRect;
  }

  // The host container's own box. Cards judged "on screen" must fall inside
  // this on both axes, since visibility is measured against the container.
  function containerRect(): DOMRect {
    return { top: 0, bottom: 600, left: 0, right: 400 } as DOMRect;
  }

  /** Registers geometry for a card id, applied when the card is measured. */
  function stubCard(id: string, rect: DOMRect) {
    const spy = vi.fn<(arg?: unknown) => void>();
    scrollSpies.set(id, spy);
    rects.set(id, rect);
    return spy;
  }

  // jsdom does not implement scrollIntoView at all, and assigning directly on
  // the prototype (rather than vi.spyOn, which requires an existing method)
  // is what makes both stubs reliable here. Saved and restored per test.
  const origRect = HTMLElement.prototype.getBoundingClientRect;
  const origScroll = (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;

  beforeEach(() => {
    scrollSpies.clear();
    rects.clear();
    // jsdom reports scrollWidth === clientWidth for every element, so no
    // ancestor ever looks scrollable and the directive would fall back to the
    // viewport path. Stub the host container to look like a real horizontal
    // strip so the strip branch is the one under test.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('appRestoreListingScroll') ? 2000 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 400;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const id = this.dataset?.['salonId'];
      if (id && rects.has(id)) return rects.get(id)!;
      if (this.hasAttribute('appRestoreListingScroll')) return containerRect();
      return origRect.call(this);
    };
    HTMLElement.prototype.scrollIntoView = function (
      this: HTMLElement,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      const id = this.dataset?.['salonId'];
      scrollSpies.get(id ?? '')?.(arg);
    };
  });

  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)['scrollWidth'];
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)['clientWidth'];
    HTMLElement.prototype.getBoundingClientRect = origRect;
    if (origScroll) HTMLElement.prototype.scrollIntoView = origScroll;
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it('scrolls the last-opened salon into view on return', async () => {
    lastViewed.record('search', 's2');
    const spy = stubCard('s2', offScreenRect());
    host.items.set(['s1', 's2', 's3']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(spy).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    });
  });

  it('does not scroll a card that is already fully visible', async () => {
    lastViewed.record('search', 's1');
    const spy = stubCard('s1', onScreenRect());
    host.items.set(['s1', 's2']);
    fixture.detectChanges();
    await fixture.whenStable();

    // Restoring onto a card the user can already see would move the page under
    // them for no reason.
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores a salon recorded by a different surface', async () => {
    // Opened from the landing page, but this listing is search — the salon may
    // not even be in this list.
    lastViewed.record('landing', 's2');
    const spy = stubCard('s2', offScreenRect());
    host.items.set(['s1', 's2', 's3']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(spy).not.toHaveBeenCalled();
  });

  it('does nothing when no salon has been opened yet', async () => {
    const spy = stubCard('s1', offScreenRect());
    host.items.set(['s1', 's2']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(spy).not.toHaveBeenCalled();
  });

  it('does not scroll when the recorded salon is not in this list', async () => {
    lastViewed.record('search', 'gone');
    const spy = stubCard('s1', offScreenRect());
    host.items.set(['s1', 's2']);
    fixture.detectChanges();
    await fixture.whenStable();

    // No match, no throw, no scroll — a filter change can legitimately drop it.
    expect(spy).not.toHaveBeenCalled();
  });

  it('remembers only a computed offset, never the position at tap time', () => {
    // Asserts on the SERVICE rather than on scroll side effects, which keeps
    // this free of requestAnimationFrame and of jsdom's no-op scrolling.
    //
    // The distinction matters: _restoreStrip runs on the tap as well as on the
    // return, and at tap time the card is already visible and the strip is
    // wherever the user left it. Recording that would overwrite a good offset
    // with an arbitrary one, and the same salon would remember a different
    // position after every tap.
    lastViewed.record('search', 's2');
    expect(lastViewed.offsetFor('search', 's2')).toBeNull();

    lastViewed.rememberOffset('search', 's2', 480, 0);
    expect(lastViewed.offsetFor('search', 's2')?.left).toBe(480);

    // A second salon must not inherit the first one's offset — keying by
    // surface alone made every listing snap back to whichever salon was
    // opened first.
    expect(lastViewed.offsetFor('search', 's3')).toBeNull();
  });

  it('does not re-scroll on a later list change (the strip fighting the user)', async () => {
    // Reported from device: scrolling the strip by hand made it snap back on
    // its own. Cause: the recorded salon was never cleared, so the effect
    // re-fired on every subsequent items() change and re-ran the restore.
    lastViewed.record('search', 's2');
    const spy = stubCard('s2', offScreenRect());
    host.items.set(['s1', 's2', 's3']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(spy).toHaveBeenCalledTimes(1);

    // The list changes again (a refetch, a cache read, a filter edit). The
    // user is mid-scroll; nothing may move.
    spy.mockClear();
    host.items.set(['s1', 's2', 's3', 's4']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(spy).not.toHaveBeenCalled();

    // A NEW array with identical contents must also not re-trigger it —
    // SalonListingService hands out a fresh array on every fetch and cache
    // read, so identity changes constantly.
    host.items.set(['s1', 's2', 's3', 's4']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(spy).not.toHaveBeenCalled();
  });

  it('waits for the list to populate before measuring', async () => {
    lastViewed.record('search', 's2');
    // Cards do not exist yet — the listing is still resolving.
    host.items.set([]);
    fixture.detectChanges();
    await fixture.whenStable();

    // Now they arrive.
    const spy = stubCard('s2', offScreenRect());
    host.items.set(['s1', 's2']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(spy).toHaveBeenCalled();
  });
});

describe('LastViewedSalonService', () => {
  let svc: LastViewedSalonService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(LastViewedSalonService);
  });

  it('returns the salon only for the surface that recorded it', () => {
    svc.record('search', 's1');
    expect(svc.forSurface('search')).toBe('s1');
    expect(svc.forSurface('landing')).toBeNull();
    expect(svc.forSurface('favorites')).toBeNull();
  });

  it('keeps only the most recent salon', () => {
    svc.record('search', 's1');
    svc.record('search', 's2');
    expect(svc.forSurface('search')).toBe('s2');
  });

  it('a later surface replaces the earlier one', () => {
    svc.record('search', 's1');
    svc.record('landing', 'l1');
    // Only one salon is tracked at a time — search no longer restores.
    expect(svc.forSurface('search')).toBeNull();
    expect(svc.forSurface('landing')).toBe('l1');
  });

  it('clear() forgets everything', () => {
    svc.record('search', 's1');
    svc.clear();
    expect(svc.forSurface('search')).toBeNull();
  });
});
