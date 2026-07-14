import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SalonListingService } from './salon-listing.service';
import { BillingService } from '../../features/organization/billing/billing.service';
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
import { IconComponent } from '../../shared/components/icon/icon.component';
import { InstallPromptService } from '../../core/pwa/install-prompt.service';
import { RoutePath, RouteQueryParam } from '../../core/routing/route-paths';

@Component({
  selector: 'app-landing',
  templateUrl: './landing.component.html',
  imports: [
    RouterLink,
    SalonCardComponent,
    CategoryPillsComponent,
    PaginationComponent,
    SkeletonComponent,
    IconComponent,
  ],
})
export class LandingComponent implements OnInit {
  protected readonly listing = inject(SalonListingService);
  protected readonly categoriesService = inject(CategoriesService);
  protected readonly install = inject(InstallPromptService);
  private readonly _favorites = inject(FavoritesService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _route = inject(ActivatedRoute);
  private readonly _billing = inject(BillingService);
  // private readonly _geoLocation = inject(GeoLocationService);

  protected readonly registerLink = RoutePath.register();
  protected readonly howToInstallLink = RoutePath.howToInstall();

  protected readonly steps = [
    {
      number: '1',
      title: 'Set up your salon',
      description:
        'Add your salon details, invite your staffs, and define your services in minutes.',
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

    this._handlePaymentReturnIfPresent();
  }

  // Flutterwave's redirect_url is set to /org/:orgId/billing/payment/callback
  // when a checkout session is created, but subscription/Payment Plan
  // checkouts have been observed ignoring that and landing here (the bare
  // domain root) instead, with the same ?status=&tx_ref=&transaction_id=
  // query params. Detect that case and run the same verify flow
  // PaymentCallbackComponent would have — orgId isn't in this route, so it's
  // parsed out of tx_ref (format: hairmela_{orgId}_{tier}_{timestamp}).
  private _handlePaymentReturnIfPresent(): void {
    const status = this._route.snapshot.queryParamMap.get(RouteQueryParam.STATUS);
    const txRef = this._route.snapshot.queryParamMap.get(RouteQueryParam.TX_REF);
    if (!status || !txRef) return;

    const parts = txRef.split('_');
    const orgId = parts.length === 4 && parts[0] === 'hairmela' ? parts[1] : null;
    if (!orgId) return;

    this._billing.handlePaymentReturn(orgId, status, txRef);
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.listing.setSearch(value);
  }

  protected onCategorySelect(slug: string): void {
    this.listing.setCategory(slug);
  }
}
