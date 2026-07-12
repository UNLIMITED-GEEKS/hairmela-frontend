import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalonListingItemDto } from '../../../api/models/salon-listing-item-dto';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { FavoritesService } from '../../../core/favorites/favorites.service';
import { MediaUrlPipe } from '../../pipes/media-url.pipe';
import { IconComponent } from '../icon/icon.component';

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
  host: { class: 'block h-full' },
})
export class SalonCardComponent {
  readonly salon = input.required<SalonListingItemDto>();

  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _favorites = inject(FavoritesService);

  // Fallback photo for salons with no uploaded image — drop the file at
  // public/salon-placeholder.jpg (served at the site root, no import needed).
  protected readonly placeholderImage = '/salon-placeholder.jpg';

  protected readonly isLoggedIn = computed(() => !!this._currentUser.user());

  protected readonly detailLink = computed(() =>
    this.isLoggedIn() ? ['/s', this.salon().slug] : ['/g', 's', this.salon().slug],
  );

  // Heart shown only when authenticated (handoff §2) — absent, not disabled,
  // for anonymous/guest visitors.
  protected readonly showHeart = this.isLoggedIn;

  protected readonly isFavorited = computed(() => this._favorites.isFavorited(this.salon().id));

  protected toggleFavorite(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this._favorites.toggle(this.salon());
  }
}
