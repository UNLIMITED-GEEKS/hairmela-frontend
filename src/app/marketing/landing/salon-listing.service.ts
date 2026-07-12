import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../api/api-configuration';
import { publicSalonsControllerFindListing } from '../../api/fn/salons/public-salons-controller-find-listing';
import { SalonListingItemDto } from '../../api/models/salon-listing-item-dto';
import { PaginatedMetaDto } from '../../api/models/paginated-meta-dto';
import { TtlGate } from '../../core/caching/ttl/ttl-gate';

export interface ListingFilters {
  state: string;
  city: string;
  search: string;
  category: string;
}

const PAGE_SIZE = 18; // 6 rows x 3 columns on desktop
const TTL_MS = 120_000; // 2 minutes — skip refetch on unchanged filters/page (e.g. back-navigation)

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
  private readonly _filters = signal<ListingFilters>({ state: '', city: '', search: '', category: '' });
  private readonly _page = signal(1);

  readonly items = this._items.asReadonly();
  readonly meta = this._meta.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly page = this._page.asReadonly();

  private readonly _searchInput$ = new Subject<string>();
  private readonly _refetch$ = new Subject<void>();

  // Guards against refetching the exact same filters+page within the TTL
  // window (e.g. the user navigates to a salon and hits back) — any actual
  // change in filters/page always bypasses this and fetches immediately.
  private readonly _ttl = new TtlGate(TTL_MS);
  private _lastFetchKey = '';

  constructor() {
    this._searchInput$
      .pipe(debounceTime(500), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((search) => {
        // Search always wins over an active category — the two filters don't combine.
        this._filters.update((f) => ({ ...f, search, category: '' }));
        this._page.set(1);
        this._refetch$.next();
      });

    this._refetch$
      .pipe(
        switchMap(() => {
          const { state, city, search, category } = this._filters();
          const key = JSON.stringify({ state, city, search, category, page: this._page() });
          if (key === this._lastFetchKey && this._ttl.isFresh()) {
            return EMPTY;
          }
          this._lastFetchKey = key;
          this._loading.set(true);
          return publicSalonsControllerFindListing(this._http, this._apiConfig.rootUrl, {
            state: state || undefined,
            city: city || undefined,
            search: search || undefined,
            category: category || undefined,
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
        this._ttl.markFetched();
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

  // Not debounced — selecting a category chip is a deliberate, infrequent action.
  setCategory(category: string): void {
    this._filters.update((f) => ({ ...f, category }));
    this._page.set(1);
    this._refetch$.next();
  }

  goToPage(page: number): void {
    if (page < 1 || (this._meta() && page > this._meta()!.totalPages)) return;
    this._page.set(page);
    this._refetch$.next();
  }
}
