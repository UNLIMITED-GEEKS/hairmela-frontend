import { Component, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  imports: [IconComponent, SalonCardComponent, CategoryPillsComponent, PaginationComponent, SkeletonComponent],
  providers: [SalonListingService],
})
export class SearchComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  protected readonly listing = inject(SalonListingService);
  protected readonly categoriesService = inject(CategoriesService);
  private readonly _favorites = inject(FavoritesService);
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly initialSearch =
    this._route.snapshot.queryParamMap.get(RouteQueryParam.SEARCH) ?? '';

  // Two-row horizontal-scroll layout — split into two explicit rows instead
  // of relying on CSS grid-flow-col, which wasn't reliably wrapping/scrolling
  // extra columns on mobile. Column-major order (item 0 -> row1, item 1 ->
  // row2, item 2 -> row1, ...) so consecutive results sit in the same column.
  // Below 4 results there's nothing to gain from a second row (bottomRow
  // would end up sparse/empty), so those render as a single row instead.
  protected readonly useSingleRow = computed(() => this.listing.items().length < 4);
  protected readonly topRow = computed(() =>
    this.listing.items().filter((_, i) => i % 2 === 0),
  );
  protected readonly bottomRow = computed(() =>
    this.listing.items().filter((_, i) => i % 2 === 1),
  );

  ngOnInit(): void {
    this.categoriesService.load();

    if (this._currentUser.user()) {
      this._favorites.ensureIdsLoaded();
    }

    if (this.initialSearch) {
      this.listing.setSearch(this.initialSearch);
    }
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.listing.setSearch(value);
  }

  protected onCategorySelect(slug: string): void {
    this.listing.setCategory(slug);
  }
}
