import {
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
} from '@angular/core';
import { LastViewedSalonService, ListingSurface } from '../../core/scroll/last-viewed-salon.service';

/** How far past a container edge still counts as "inside" it. */
const EDGE_TOLERANCE_PX = 2;
/** Gap left above a revealed row so it does not sit flush against the edge. */
const REVEAL_MARGIN_PX = 16;

interface Axis {
  readonly overflow: 'overflowX' | 'overflowY';
  readonly scrollSize: 'scrollWidth' | 'scrollHeight';
  readonly clientSize: 'clientWidth' | 'clientHeight';
  readonly start: 'left' | 'top';
  readonly end: 'right' | 'bottom';
}

const HORIZONTAL: Axis = {
  overflow: 'overflowX',
  scrollSize: 'scrollWidth',
  clientSize: 'clientWidth',
  start: 'left',
  end: 'right',
};

const VERTICAL: Axis = {
  overflow: 'overflowY',
  scrollSize: 'scrollHeight',
  clientSize: 'clientHeight',
  start: 'top',
  end: 'bottom',
};

/**
 * Scrolls the salon card the user last opened back into view when they return
 * to a listing. Put it on the element that CONTAINS the cards:
 *
 *   <div class="grid ..."
 *        appRestoreListingScroll
 *        surface="search"
 *        [items]="listing.items()">
 *
 * One directive covers every listing because two axes are handled explicitly:
 * the card is brought into view within its horizontal strip (search on mobile,
 * the landing and dashboard rows) AND within the page's own vertical scroller
 * (the auth/guest shells scroll an inner <main>, not the window, so the
 * router's own scroll restoration cannot reach it).
 *
 * Nothing moves when the card is already in view — a listing that repositions
 * itself under a user who can already see what they came back for is worse
 * than one that does nothing.
 */
@Directive({
  selector: '[appRestoreListingScroll]',
})
export class RestoreListingScrollDirective {
  readonly surface = input.required<ListingSurface>();

  /**
   * The rendered list. Passed as the array itself, not a count: the effect
   * needs a dependency that genuinely changes when the list does, and a plain
   * number silently disables the whole feature if a caller ever passes a
   * constant.
   */
  readonly items = input.required<readonly { id: string }[]>();

  private readonly _host = inject(ElementRef<HTMLElement>);
  private readonly _injector = inject(Injector);
  private readonly _lastViewed = inject(LastViewedSalonService);

  // No per-instance "have we restored" state: the container is destroyed and
  // rebuilt many times while a page settles (the dashboard rebuilt it ~14
  // times in one browsing session), so a fresh directive with empty state is
  // the norm, not the exception. The achieved scroll offset lives on
  // LastViewedSalonService, which outlives every rebuild.
  constructor() {
    effect(() => {
      const items = this.items();
      const surface = this.surface();
      if (items.length === 0) return;

      const salonId = this._lastViewed.forSurface(surface);
      if (!salonId) return;

      afterNextRender(
        () => {
          const card = this._findCard(salonId);
          // Cards not rendered yet — leave the restore pending for the render
          // that has them, rather than spending it on an empty container.
          if (!card) return;

          // A restore is a ONE-SHOT instruction: "the user just came back, put
          // this card in view". Consuming it here is what stops it becoming
          // standing state — left set, it re-fired on every later change to
          // the list and yanked the strip back while the user was scrolling it
          // by hand.
          //
          // The remembered OFFSET is deliberately not cleared with it: the
          // container is rebuilt several times as a page settles, and this
          // directive is recreated with it, so _apply still needs to correct a
          // freshly-rebuilt strip back to where the restore put it. That path
          // only touches a strip sitting at scrollLeft 0 (see _restoreStrip),
          // so it cannot interfere with a user who has scrolled since.
          this._lastViewed.consumeFor(surface);
          this._apply(salonId, surface);
        },
        { injector: this._injector },
      );
    });
  }

  private _apply(salonId: string, surface: ListingSurface): void {
    const card = this._findCard(salonId);
    if (!card) return;

    const strip = this._scrollParent(card, HORIZONTAL);
    if (strip) {
      this._restoreStrip(card, strip, salonId, surface);
    } else if (!this._isInView(card, HORIZONTAL)) {
      card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }

    // Always considered, whatever happened horizontally: being in view WITHIN
    // a strip says nothing about whether that strip is on screen at all, and
    // on a long page the row is usually below the fold.
    this._reveal(card, VERTICAL);
  }

  /**
   * Brings the card into view within its horizontal strip, and records the
   * offset that achieved it.
   *
   * The offset is recorded ONLY when an actual scroll computed it. This method
   * also runs at tap time, when the card is by definition already visible and
   * the strip is simply wherever the user left it — recording that would
   * overwrite a good offset with an arbitrary one, and the same salon would
   * remember a different position after every tap.
   */
  private _restoreStrip(
    card: HTMLElement,
    strip: HTMLElement,
    salonId: string,
    surface: ListingSurface,
  ): void {
    // A rebuilt strip starts at 0 with identical content and geometry, so a
    // previously-achieved offset is still exactly right — and re-applying it
    // is more reliable than re-deriving it on an element that may be replaced
    // again a frame later. A strip the user has since scrolled is left alone.
    const remembered = this._lastViewed.offsetFor(surface, salonId);
    if (remembered && strip.scrollLeft === 0 && remembered.left > 0) {
      strip.scrollLeft = remembered.left;
      if (remembered.top > 0) strip.scrollTop = remembered.top;
      // Falls through to the check below rather than trusting the offset: it
      // can be stale if the list changed (a salon added, removed, reordered).
    }

    if (this._isInView(card, HORIZONTAL)) return;

    card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    this._lastViewed.rememberOffset(surface, salonId, strip.scrollLeft, strip.scrollTop);
  }

  /** Scrolls the card into view on one axis, if it is not already. */
  private _reveal(card: HTMLElement, axis: Axis): void {
    if (this._isInView(card, axis)) return;

    const scroller = this._scrollParent(card, axis);
    const rect = card.getBoundingClientRect();

    if (!scroller) {
      window.scrollBy({ top: rect.top - REVEAL_MARGIN_PX, behavior: 'auto' });
      return;
    }

    const box = scroller.getBoundingClientRect();
    scroller.scrollTop += rect[axis.start] - box[axis.start] - REVEAL_MARGIN_PX;
  }

  private _findCard(salonId: string): HTMLElement | null {
    const host = this._host.nativeElement as HTMLElement;
    // Matched on the dataset rather than via a selector built by string
    // concatenation: salon ids come from the server, and CSS.escape is absent
    // in some environments (jsdom, older WebViews) so it cannot be relied on
    // to make a concatenated selector safe.
    return (
      Array.from(host.querySelectorAll<HTMLElement>('[data-salon-id]')).find(
        (el) => el.dataset['salonId'] === salonId,
      ) ?? null
    );
  }

  /**
   * Whether the card sits inside its scroll container on the given axis,
   * falling back to the viewport when nothing scrolls on that axis.
   *
   * Measured against the CONTAINER, not the window: a card scrolled out of a
   * horizontal strip can still be within the viewport box, and vice versa.
   * Measuring against the window made the same card read as both "visible"
   * and "needs scrolling" depending on which container it was measured in.
   *
   * The tolerance is essential, not defensive. getBoundingClientRect returns
   * fractional pixels, and the LAST card in a strip sits flush against the
   * container edge once scroll is maxed out — so an exact comparison fails by
   * a fraction of a pixel and that card can never be judged visible.
   */
  private _isInView(el: HTMLElement, axis: Axis): boolean {
    const rect = el.getBoundingClientRect();
    const scroller = this._scrollParent(el, axis);
    const T = EDGE_TOLERANCE_PX;

    if (scroller) {
      const box = scroller.getBoundingClientRect();
      return rect[axis.start] >= box[axis.start] - T && rect[axis.end] <= box[axis.end] + T;
    }

    const viewportEnd = axis === VERTICAL ? window.innerHeight || 0 : window.innerWidth || 0;
    return rect[axis.start] >= -T && rect[axis.end] <= viewportEnd + T;
  }

  /** Nearest ancestor that actually scrolls on the given axis, else null. */
  private _scrollParent(el: HTMLElement, axis: Axis): HTMLElement | null {
    let node = el.parentElement;
    while (node && node !== document.body) {
      // Size check first — a cheap property read. Skipping getComputedStyle
      // for the many non-scrolling ancestors keeps this walk off the
      // forced-reflow path.
      if (node[axis.scrollSize] > node[axis.clientSize]) {
        const overflow = getComputedStyle(node)[axis.overflow];
        if (/(auto|scroll|overlay)/.test(overflow)) return node;
      }
      node = node.parentElement;
    }
    return null;
  }
}
