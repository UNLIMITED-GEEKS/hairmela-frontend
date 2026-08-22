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

/**
 * Scrolls the salon card the user last opened back into view when they return
 * to a listing. Put it on the element that CONTAINS the cards:
 *
 *   <div class="grid ..." appRestoreListingScroll surface="search" [ready]="listing.items().length">
 *
 * One directive covers every listing because scrollIntoView with
 * block/inline: 'nearest' resolves the axis itself — it scrolls whichever
 * ancestor actually overflows and leaves an axis alone when the element is
 * already visible on it. That matters here: search is a horizontal strip on
 * mobile and a vertical grid on desktop, and its mobile layout further splits
 * results across two rows. None of that needs to be known at this level.
 *
 * `ready` exists because the cards usually do not exist yet at mount — the
 * listing may still be resolving from cache or a fetch. Passing the item count
 * lets the effect wait for a non-zero render before measuring, the same way
 * the category pills wait for their categories to load.
 */
@Directive({
  selector: '[appRestoreListingScroll]',
})
export class RestoreListingScrollDirective {
  readonly surface = input.required<ListingSurface>();
  /** Item count — any change re-checks; a non-zero value means cards exist. */
  readonly ready = input<number>(0);

  private readonly _host = inject(ElementRef<HTMLElement>);
  private readonly _injector = inject(Injector);
  private readonly _lastViewed = inject(LastViewedSalonService);

  // The id we last scrolled to, NOT a boolean "have we restored".
  //
  // A boolean latched for the lifetime of the directive, and Angular REUSES a
  // routed component instance across back-navigation rather than recreating
  // it — so after the first restore the flag stayed true and every later
  // return was ignored, leaving the user looking at the first salon they ever
  // opened. Keying on the id means a newly-opened salon is always a fresh
  // restore, while a repeat of the same id (pagination, a filter edit, any
  // other items() change) correctly does nothing.
  // No per-instance "have we restored" state: the container is destroyed and
  // rebuilt several times while the page settles, so a fresh directive with
  // empty state is the norm, not the exception. The achieved scroll offset
  // lives on LastViewedSalonService instead, which outlives every rebuild.

  constructor() {
    effect(() => {
      const count = this.ready();
      const surface = this.surface();
      if (count === 0) return;

      const salonId = this._lastViewed.forSurface(surface);
      if (!salonId) return;

      afterNextRender(() => this._apply(salonId, surface), { injector: this._injector });
    });
  }

  private _apply(salonId: string, surface: ListingSurface): void {
    const host = this._host.nativeElement as HTMLElement;
    const card = Array.from(host.querySelectorAll<HTMLElement>('[data-salon-id]')).find(
      (el) => el.dataset['salonId'] === salonId,
    );
    if (!card) {
      return;
    }

    const scroller = this._scrollParent(card);
    if (!scroller) {
      if (!this._isFullyVisible(card)) {
        card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      }
      return;
    }

    // A rebuilt container starts at 0 with the same content and geometry, so a
    // previously-achieved offset is still exactly right. Re-applying it is
    // both cheaper and more reliable than re-deriving it via scrollIntoView on
    // an element that may be replaced again a frame later.
    // Re-apply the offset that previously put THIS salon's card in view. Only
    // a fresh container (scrollLeft 0) is a rebuild worth correcting; a user
    // who has since scrolled somewhere else is left alone.
    const remembered = this._lastViewed.offsetFor(surface, salonId);
    if (remembered && scroller.scrollLeft === 0 && remembered.left > 0) {
      scroller.scrollLeft = remembered.left;
      if (remembered.top > 0) scroller.scrollTop = remembered.top;
      // Deliberately NOT returning: fall through and verify the card really is
      // in view now. A remembered offset can be stale if the list changed
      // (a salon added, removed, or reordered), and returning here would trust
      // it blindly.
    }

    if (this._isFullyVisible(card)) {
      // Deliberately does NOT save the offset here. This branch runs on the
      // TAP as well as on the return, and at tap time scrollLeft is simply
      // wherever the user happened to be — saving it overwrote the good offset
      // with an arbitrary one, and the same salon ended up with a different
      // "remembered" position every time it was tapped.
      return;
    }

    card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    // Only a position we actually COMPUTED is worth remembering — it is the
    // one that genuinely brings this card into view, so a rebuilt container
    // can be corrected back to it.
    this._lastViewed.rememberOffset(surface, salonId, scroller.scrollLeft, scroller.scrollTop);
  }

  // Visibility is judged against the element that actually SCROLLS, not the
  // window. These cards usually sit in an overflow-x-auto strip: a card can be
  // scrolled out of that strip while still inside the viewport box, and a
  // card at viewport-x 1472 may be perfectly in view once the strip's own
  // scrollLeft is taken into account. Measuring against the window produced
  // exactly that contradiction — the same card read as "fully visible" and
  // "needs scrolling" depending on which container it was measured in.
  private _isFullyVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();

    // Walk up to the nearest actually-scrollable ancestor, if any.
    const scroller = this._scrollParent(el);
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      // TOLERANCE is essential, not defensive. getBoundingClientRect returns
      // fractional pixels, and the LAST card in a strip sits flush against the
      // container edge once scrollLeft is maxed out — so an exact
      // `rect.right <= box.right` fails by a fraction of a pixel and the card
      // is judged "not visible" even though it is perfectly in place. That
      // made the re-apply loop run to exhaustion on the final card while
      // scrollLeft never actually moved.
      const T = 2;
      return (
        rect.top >= box.top - T &&
        rect.bottom <= box.bottom + T &&
        rect.left >= box.left - T &&
        rect.right <= box.right + T
      );
    }

    const T = 2;
    const viewportH = window.innerHeight || 0;
    const viewportW = window.innerWidth || 0;
    return (
      rect.top >= -T &&
      rect.bottom <= viewportH + T &&
      rect.left >= -T &&
      rect.right <= viewportW + T
    );
  }

  /** Nearest ancestor that can actually scroll on either axis, else null. */
  private _scrollParent(el: HTMLElement): HTMLElement | null {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const canScrollX = node.scrollWidth > node.clientWidth;
      const canScrollY = node.scrollHeight > node.clientHeight;
      if (canScrollX || canScrollY) {
        const style = getComputedStyle(node);
        const overflow = style.overflowX + style.overflowY;
        if (/(auto|scroll|overlay)/.test(overflow)) return node;
      }
      node = node.parentElement;
    }
    return null;
  }
}
