import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalonListingService } from './salon-listing.service';
// Geolocation-based location default disabled for now — inaccurate results
// (IP-based geolocation resolves to the nearest ISP hub, not the visitor's
// actual city). See geo-location.service.ts. Re-enable by restoring the
// import and the resolveLocation() call in ngOnInit below.
// import { GeoLocationService } from './geo-location.service';
import { FavoritesService } from '../../core/favorites/favorites.service';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { CategoriesService } from '../../core/categories/categories.service';
import { SalonCardComponent } from '../../shared/components/salon-card/salon-card.component';
import { CategoryPillsComponent } from '../../shared/components/category-pills/category-pills.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { RoutePath } from '../../core/routing/route-paths';

@Component({
  selector: 'app-landing',
  templateUrl: './landing.component.html',
  imports: [RouterLink, SalonCardComponent, CategoryPillsComponent, PaginationComponent, SkeletonComponent],
})
export class LandingComponent implements OnInit {
  protected readonly listing = inject(SalonListingService);
  protected readonly categoriesService = inject(CategoriesService);
  private readonly _favorites = inject(FavoritesService);
  private readonly _currentUser = inject(CurrentUserStore);
  // private readonly _geoLocation = inject(GeoLocationService);

  protected readonly registerLink = RoutePath.register();

  protected readonly steps = [
    {
      number: '1',
      title: 'Set up your salon',
      description: 'Add your salon details, invite barbers, and define your services in minutes.',
    },
    {
      number: '2',
      title: 'Share your queue link',
      description: 'Customers scan your QR code or tap your link to see your live queue.',
    },
    {
      number: '3',
      title: 'Serve clients smoothly',
      description: 'Call the next client, track service time, and manage walk-ins from your phone.',
    },
  ];

  ngOnInit(): void {
    this.categoriesService.load();

    // Hearts on the listing cards need to know what's already favourited —
    // only worth loading for a signed-in visitor (the cards hide the heart
    // entirely for guests/anonymous, so there's nothing to prefetch for them).
    if (this._currentUser.user()) {
      this._favorites.ensureIdsLoaded();
    }

    // Location default (handoff §3) — DISABLED, see the import comment above.
    // void this._geoLocation.resolveLocation().then((location) => {
    //   if (location) this.listing.setLocation(location.state, location.city);
    // });
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.listing.setSearch(value);
  }

  protected onCategorySelect(slug: string): void {
    this.listing.setCategory(slug);
  }
}
