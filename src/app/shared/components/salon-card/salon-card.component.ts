import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalonListingItemDto } from '../../../api/models/salon-listing-item-dto';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { FavoritesService } from '../../../core/favorites/favorites.service';
import { MediaUrlPipe } from '../../pipes/media-url.pipe';
import { IconComponent } from '../icon/icon.component';
import { RoutePath, RouteSegment, RouteQueryParam } from '../../../core/routing/route-paths';
import { LastViewedSalonService, ListingSurface } from '../../../core/scroll/last-viewed-salon.service';

// Shared salon "card" — identical shape used by the homepage listing and the
// favourites page (FRONTEND-FAVORITES-LISTING-HANDOFF §3). Always links to the
// full detail page by SLUG (never the id) — signed-in users land on the authed
// /s/:slug, everyone else (guest or fully anonymous) lands on /g/s/:slug, the
// only slug route reachable without a session.
@Component({
  selector: 'app-salon-card',
  templateUrl: './salon-card.component.html',
  imports: [RouterLink, MediaUrlPipe, IconComponent],
  // The card sits in a CSS grid whose rows stretch to their tallest item by
  // default — the host itself must also stretch (block-level custom elements
  // don't inherit that height automatically) so the template's h-full <a>
  // actually has a full row-height box to fill.
  // data-salon-id is what RestoreListingScrollDirective queries for when
  // scrolling the last-opened salon back into view. On the HOST rather than
  // the inner <a> so the element found is the card's full box.
  host: {
    'class': 'block h-full',
    '[attr.data-salon-id]': 'salon().id',
    // pointerdown, not click: the listing container is torn down and rebuilt
    // while the page settles, and a click that starts on a card destroyed
    // mid-gesture never completes — so the tap went unrecorded and the
    // listing restored to whichever salon was opened first. pointerdown fires
    // immediately on press, before any rebuild can steal the element.
    '(pointerdown)': 'onCardClick()',
  },
})
export class SalonCardComponent {
  readonly salon = input.required<SalonListingItemDto>();
  // Adds the street line to the address. Off by default (city/state is enough
  // in a mixed listing); on where several same-named or nearby salons sit
  // side by side — the branch picker (branches all share the root's name) and
  // favourites.
  readonly showStreet = input(false);
  /**
   * Category slug the viewer is currently filtering by, if any. Passed through
   * to the salon page so it can open on that category's services instead of
   * making the customer find it again.
   *
   * An INPUT rather than read from SalonListingService: this card also renders
   * on favourites, the branch picker and the landing page, none of which have
   * a category filter. Reaching into that service here would make the card
   * lie about context it does not have.
   */
  readonly activeCategory = input<string>('');

  /**
   * Which listing this card belongs to. Set it wherever a return-to-listing
   * scroll restore is wanted; left unset (the branch picker, for instance) the
   * card records nothing and no restore happens.
   *
   * An input for the same reason activeCategory is: the card renders on
   * several surfaces and must not guess which one it is on.
   */
  readonly surface = input<ListingSurface | null>(null);

  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _favorites = inject(FavoritesService);
  private readonly _lastViewed = inject(LastViewedSalonService);

  // Fallback photo for salons with no uploaded image — drop the file at
  // public/salon-placeholder.jpg (served at the site root, no import needed).
  protected readonly placeholderImage = '/salon-placeholder.jpg';

  protected readonly isLoggedIn = computed(() => !!this._currentUser.user());

  // A multi-branch root links to its location picker instead of its own
  // slug page — /s/:slug always shows a salon's own real page now (root or
  // branch), so a root with branches is reached via /branches/:slug instead,
  // decided here from data already on the card, not by fetching the slug
  // first (see branch-picker.component.ts).
  protected readonly detailLink = computed(() => {
    const { slug, hasBranches } = this.salon();
    const base = this.isLoggedIn() ? '' : `/${RouteSegment.G}`;
    return hasBranches ? RoutePath.visitBranches(base, slug) : RoutePath.visitSalon(base, slug);
  });

  // Only present when a filter is actually active — an unfiltered browse or a
  // search produces a clean URL, since there is no category intent to carry.
  protected readonly detailQueryParams = computed(() => {
    const category = this.activeCategory();
    return category ? { [RouteQueryParam.CATEGORY]: category } : {};
  });

  // Recorded on the way out so returning to the listing can scroll this card
  // back into view. Fires on the host click, which covers the whole card
  // (including the photo and the name bar), not just the anchor text.
  //
  // The favourite heart calls stopPropagation(), so favouriting a salon does
  // NOT record it here — only a tap that actually opens the salon does.
  protected onCardClick(): void {
    const surface = this.surface();
    if (!surface) return;
    this._lastViewed.record(surface, this.salon().id);
  }

  // branchCount is nullable on the wire, so fall back to a count-free label
  // rather than rendering a badge with a blank number in it.
  protected readonly branchCountLabel = computed(() => {
    const count = this.salon().branchCount;
    if (count === null) return 'Multiple locations';
    return `${count} ${count === 1 ? 'Location' : 'Locations'}`;
  });

  // Heart shown only when authenticated (handoff §2) — absent, not disabled,
  // for anonymous/guest visitors. Also hidden for a multi-branch root: the
  // card links to the location picker, not a single favouritable salon page,
  // so there's no one salon here to favourite.
  protected readonly showHeart = computed(() => this.isLoggedIn() && !this.salon().hasBranches);

  protected readonly isFavorited = computed(() => this._favorites.isFavorited(this.salon().id));

  protected toggleFavorite(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this._favorites.toggle(this.salon());
  }
}
