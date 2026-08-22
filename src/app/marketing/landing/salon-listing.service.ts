import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../api/api-configuration';
import { publicSalonsControllerFindListing } from '../../api/fn/salons/public-salons-controller-find-listing';
import { SalonListingItemDto } from '../../api/models/salon-listing-item-dto';
import { PaginatedMetaDto } from '../../api/models/paginated-meta-dto';
import { CacheRegistry, Clearable } from '../../core/caching/cache-registry/cache-registry.service';

interface CachedPage {
  readonly items: SalonListingItemDto[];
  readonly meta: PaginatedMetaDto | null;
}

export interface ListingFilters {
  state: string;
  city: string;
  search: string;
  category: string;
}

const PAGE_SIZE = 18; // 6 rows x 3 columns on desktop

// Homepage salon listing — search/filter/pagination against GET /salons
// (public, no auth). Debounces search input so every keystroke doesn't fire
// a request; state/city changes and page changes go straight through.
@Injectable({ providedIn: 'root' })
export class SalonListingService implements Clearable {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _cacheRegistry = inject(CacheRegistry);

  private readonly _items = signal<SalonListingItemDto[]>([]);
  private readonly _meta = signal<PaginatedMetaDto | null>(null);
  private readonly _loading = signal(true);
  private readonly _filters = signal<ListingFilters>({
    state: '',
    city: '',
    search: '',
    category: '',
  });
  private readonly _page = signal(1);

  readonly items = this._items.asReadonly();
  readonly meta = this._meta.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly page = this._page.asReadonly();

  private readonly _searchInput$ = new Subject<string>();
  private readonly _refetch$ = new Subject<void>();

  // SESSION CACHE, keyed by filters+page. Each distinct combination is
  // fetched once and reused for the rest of the session.
  //
  // This replaced a single-key TTL gate that only remembered the LAST fetch:
  // toggling category A -> B -> A refetched A, because the key no longer
  // matched. It guarded against re-requesting the same thing twice in a row,
  // which is not the pattern users actually have — they toggle between
  // filters.
  //
  // NO TTL, deliberately (product decision): switching back to a viewed
  // filter is instant for the whole session. The accepted trade-off is that
  // each card's `isOpen` badge is a server-computed boolean, so a salon that
  // opens or closes mid-session keeps its stale badge until reload. The
  // listing payload carries no operating hours, so it cannot be recomputed
  // client-side without a backend change.
  private readonly _cache = new Map<string, CachedPage>();
  // The key of the request currently in flight — see the subscribe below.
  private _pendingKey = '';

  constructor() {
    this._cacheRegistry.register(this);

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

          // Cache hit — render immediately, no request. This is the whole
          // point: toggling between categories the user has already seen
          // costs nothing.
          const cached = this._cache.get(key);
          if (cached) {
            this._items.set(cached.items);
            this._meta.set(cached.meta);
            this._loading.set(false);
            return EMPTY;
          }

          this._pendingKey = key;
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
        const items = res.body.data ?? [];
        const meta = res.body.meta ?? null;
        // Keyed by the filters that were live when the request STARTED —
        // switchMap cancels superseded requests, so a fast toggle can only
        // ever resolve the latest one, but reading _filters() here would
        // still be the wrong source of truth.
        this._cache.set(this._pendingKey, { items, meta });
        this._items.set(items);
        this._meta.set(meta);
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

  // Not debounced — selecting a category chip is a deliberate, infrequent action.
  setCategory(category: string): void {
    this._filters.update((f) => ({ ...f, category }));
    this._page.set(1);
    this._refetch$.next();
  }

  /**
   * Drops every cached page. Called by CacheRegistry on logout so one user's
   * browse results never survive into another's session.
   */
  clear(): void {
    this._cache.clear();
  }

  /**
   * Forces a refetch of the current filters, bypassing the cache.
   *
   * Needed because there is no TTL: without this, a page cached early in the
   * session would never update, and pull-to-refresh would appear to do
   * nothing on the listing.
   */
  refresh(): void {
    const { state, city, search, category } = this._filters();
    this._cache.delete(
      JSON.stringify({ state, city, search, category, page: this._page() }),
    );
    this._refetch$.next();
  }

  goToPage(page: number): void {
    if (page < 1 || (this._meta() && page > this._meta()!.totalPages)) return;
    this._page.set(page);
    this._refetch$.next();
  }
}
