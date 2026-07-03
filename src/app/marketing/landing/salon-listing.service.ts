import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../api/api-configuration';
import { publicSalonsControllerFindListing } from '../../api/fn/salons/public-salons-controller-find-listing';
import { SalonListingItemDto } from '../../api/models/salon-listing-item-dto';
import { PaginatedMetaDto } from '../../api/models/paginated-meta-dto';

export interface ListingFilters {
  state: string;
  city: string;
  search: string;
}

const PAGE_SIZE = 18; // 6 rows x 3 columns on desktop

// Homepage salon listing — search/filter/pagination against GET /salons
// (public, no auth). Debounces search input so every keystroke doesn't fire
// a request; state/city changes and page changes go straight through.
@Injectable()
export class SalonListingService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  private readonly _items = signal<SalonListingItemDto[]>([]);
  private readonly _meta = signal<PaginatedMetaDto | null>(null);
  private readonly _loading = signal(true);
  private readonly _filters = signal<ListingFilters>({ state: '', city: '', search: '' });
  private readonly _page = signal(1);

  readonly items = this._items.asReadonly();
  readonly meta = this._meta.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly page = this._page.asReadonly();

  private readonly _searchInput$ = new Subject<string>();
  private readonly _refetch$ = new Subject<void>();

  constructor() {
    this._searchInput$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((search) => {
        this._filters.update((f) => ({ ...f, search }));
        this._page.set(1);
        this._refetch$.next();
      });

    this._refetch$
      .pipe(
        switchMap(() => {
          this._loading.set(true);
          const { state, city, search } = this._filters();
          return publicSalonsControllerFindListing(this._http, this._apiConfig.rootUrl, {
            state: state || undefined,
            city: city || undefined,
            search: search || undefined,
            page: this._page(),
            limit: PAGE_SIZE,
          });
        }),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        this._items.set(res.body.data ?? []);
        this._meta.set(res.body.meta ?? null);
        this._loading.set(false);
      });

    this._refetch$.next();
  }

  // Debounced — safe to call on every keystroke.
  setSearch(value: string): void {
    this._searchInput$.next(value);
  }

  // Not debounced — a location filter is a deliberate, infrequent action.
  setLocation(state: string, city: string): void {
    this._filters.update((f) => ({ ...f, state, city }));
    this._page.set(1);
    this._refetch$.next();
  }

  goToPage(page: number): void {
    if (page < 1 || (this._meta() && page > this._meta()!.totalPages)) return;
    this._page.set(page);
    this._refetch$.next();
  }
}
