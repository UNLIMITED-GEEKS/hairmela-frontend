import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SalonCardComponent } from '../../shared/components/salon-card/salon-card.component';
import { CategoryPillsComponent } from '../../shared/components/category-pills/category-pills.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { SalonListingService } from '../../marketing/landing/salon-listing.service';
import { CategoriesService } from '../../core/categories/categories.service';
import { FavoritesService } from '../../core/favorites/favorites.service';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { RouteQueryParam } from '../../core/routing/route-paths';
import { ListingScrollMemoryDirective } from '../../shared/directives/listing-scroll-memory.directive';
import { NearbyButtonComponent } from '../../shared/components/nearby-button/nearby-button.component';
import { SearchPageStateStore } from './search-page-state.store';

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  providers: [SalonListingService],
  imports: [
    ListingScrollMemoryDirective,IconComponent, SalonCardComponent, CategoryPillsComponent, PaginationComponent, SkeletonComponent, NearbyButtonComponent],
})
export class SearchComponent implements OnInit, OnDestroy {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _pageState = inject(SearchPageStateStore);
  private readonly _pageStateKey = this._router.url.split('?')[0];
  protected readonly listing = inject(SalonListingService);
  protected readonly categoriesService = inject(CategoriesService);
  private readonly _favorites = inject(FavoritesService);
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly initialSearch =
    this._route.snapshot.queryParamMap.get(RouteQueryParam.SEARCH) ?? '';

  // Two-row horizontal-scroll layout — split into two explicit rows instead
  // of relying on CSS grid-flow-col, which wasn't reliably wrapping/scrolling
  // extra columns on mobile. Below 4 results there's nothing to gain from a
  // second row (the bottom row would end up sparse/empty), so those render as
  // a single row instead.
  protected readonly useSingleRow = computed(() => this.listing.items().length < 4);

  /**
   * How the two rows are filled, which depends on what the order MEANS.
   *
   * Normally column-major (0 -> top, 1 -> bottom, 2 -> top, ...) so
   * consecutive results sit in the same column — the long-standing layout for
   * browsing, where no single result claims to be "first".
   *
   * NEARBY results are ranked by distance, and column-major breaks that: each
   * row restarts at its own smallest value (top begins at the nearest, bottom
   * at the second-nearest), so scanning either row alone shows an interleaved
   * half of the ranking. Row-major keeps the order readable — the nearest
   * salons run left-to-right along the top row, and only once it is full does
   * the ranking continue into the bottom one.
   *
   * ceil on the split so the top row is never shorter than the bottom: with 7
   * results the nearest 4 lead, and 3 follow.
   */
  private readonly _splitIndex = computed(() => Math.ceil(this.listing.items().length / 2));

  protected readonly topRow = computed(() => {
    const items = this.listing.items();
    return this.listing.nearbyActive()
      ? items.slice(0, this._splitIndex())
      : items.filter((_, i) => i % 2 === 0);
  });

  protected readonly bottomRow = computed(() => {
    const items = this.listing.items();
    return this.listing.nearbyActive()
      ? items.slice(this._splitIndex())
      : items.filter((_, i) => i % 2 === 1);
  });

  ngOnInit(): void {
    this.categoriesService.load();

    if (this._currentUser.user()) {
      this._favorites.ensureIdsLoaded();
    }

    const savedState = this._pageState.take(this._pageStateKey);
    if (savedState) {
      this.listing.restoreState(savedState);
    } else if (this.initialSearch) {
      this.listing.setSearch(this.initialSearch);
    }
  }

  ngOnDestroy(): void {
    this._pageState.save(this._pageStateKey, this.listing.snapshotState());
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.listing.setSearch(value);
  }

  protected onLocationInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.listing.setLocation(value);
  }

  protected onCategorySelect(slug: string): void {
    this.listing.setCategory(slug);
  }
}
