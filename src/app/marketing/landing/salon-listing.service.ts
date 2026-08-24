import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../api/api-configuration';
import { publicSalonsControllerFindListing } from '../../api/fn/salons/public-salons-controller-find-listing';
import { publicSalonsControllerFindNearby } from '../../api/fn/salons/public-salons-controller-find-nearby';
import { SalonListingItemDto } from '../../api/models/salon-listing-item-dto';
import { NearbySalonListingItemDto } from '../../api/models/nearby-salon-listing-item-dto';
import { PaginatedMetaDto } from '../../api/models/paginated-meta-dto';
import { CacheRegistry, Clearable } from '../../core/caching/cache-registry/cache-registry.service';

// A listing row: nearby results carry distanceKm, normal ones don't.
// NearbySalonListingItemDto is otherwise identical to SalonListingItemDto.
export type ListingItem = SalonListingItemDto | NearbySalonListingItemDto;

interface CachedPage {
  readonly items: ListingItem[];
  readonly meta: PaginatedMetaDto | null;
}

// Where the visitor is, once they've asked for nearby results. Null means
// normal listing mode.
interface NearbyCoords {
  readonly lat: number;
  readonly lng: number;
}

export type NearbyError = 'denied' | 'unavailable';

export interface ListingFilters {
  location: string;
  search: string;
  category: string;
}

const PAGE_SIZE = 18; // 6 rows x 3 columns on desktop

// Homepage salon listing — search/filter/pagination against GET /salons
// (public, no auth). Both the name search and the location filter are free
// text, so both are debounced; category and page changes go straight through.
//
// Location is a single fuzzy `location=` param spanning city/street/state/
// country, not the exact-match state=/city= pair it replaced — those missed
// real data ("JOS SOUTH" vs "Jos-South") and were disabled in the UI because
// of it. The backend handles typos and ranks by relevance.
@Injectable({ providedIn: 'root' })
export class SalonListingService implements Clearable {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _cacheRegistry = inject(CacheRegistry);

  private readonly _items = signal<ListingItem[]>([]);
  private readonly _meta = signal<PaginatedMetaDto | null>(null);
  private readonly _loading = signal(true);
  private readonly _filters = signal<ListingFilters>({
    location: '',
    search: '',
    category: '',
  });
  private readonly _page = signal(1);
  // Non-null only in nearby mode. NearbySalonListingItemDto is a structural
  // superset of SalonListingItemDto (it just adds distanceKm), so _items
  // holds either and the card renders both.
  private readonly _nearby = signal<NearbyCoords | null>(null);
  private readonly _nearbyLocating = signal(false);
  private readonly _nearbyError = signal<NearbyError | null>(null);

  readonly items = this._items.asReadonly();
  readonly meta = this._meta.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly page = this._page.asReadonly();
  // True while showing nearby results — the other filters do not apply, and
  // the UI reflects that by showing an active "Near me" state.
  readonly nearbyActive = computed(() => this._nearby() !== null);
  // True only while waiting on the browser's permission prompt / fix.
  readonly nearbyLocating = this._nearbyLocating.asReadonly();
  readonly nearbyError = this._nearbyError.asReadonly();

  private readonly _searchInput$ = new Subject<string>();
  private readonly _locationInput$ = new Subject<string>();
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
        this._exitNearby();
        this._page.set(1);
        this._refetch$.next();
      });

    // Location deliberately does NOT clear search or category, unlike the
    // search pipeline above — "barbers in Jos" is the combination this filter
    // exists to express.
    this._locationInput$
      .pipe(debounceTime(500), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((location) => {
        this._filters.update((f) => ({ ...f, location }));
        this._exitNearby();
        this._page.set(1);
        this._refetch$.next();
      });

    this._refetch$
      .pipe(
        switchMap(() => {
          const { location, search, category } = this._filters();
          const nearby = this._nearby();
          // Nearby is its own mode, not another filter: the endpoint takes
          // only lat/lng/page, so the key ignores the text filters (which are
          // cleared on entry anyway) and keys on the coordinates instead.
          const key = nearby
            ? JSON.stringify({ nearby, page: this._page() })
            : JSON.stringify({ location, search, category, page: this._page() });

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
          if (nearby) {
            return publicSalonsControllerFindNearby(this._http, this._apiConfig.rootUrl, {
              lat: nearby.lat,
              lng: nearby.lng,
              page: this._page(),
              limit: PAGE_SIZE,
            });
          }
          return publicSalonsControllerFindListing(this._http, this._apiConfig.rootUrl, {
            location: location || undefined,
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

  // Debounced — free text now, safe to call on every keystroke.
  setLocation(value: string): void {
    this._locationInput$.next(value);
  }

  // Not debounced — selecting a category chip is a deliberate, infrequent action.
  setCategory(category: string): void {
    this._filters.update((f) => ({ ...f, category }));
    this._exitNearby();
    this._page.set(1);
    this._refetch$.next();
  }

  /**
   * Switches to nearby results, asking the browser for the visitor's
   * coordinates. Nearby is a distinct MODE, not another filter: the endpoint
   * accepts only lat/lng/page, so the text filters and category are cleared
   * on entry, and setting any of them again drops back to the normal listing.
   *
   * Resolves quietly on refusal — nearbyError() carries why, and the listing
   * stays exactly as it was.
   *
   * KNOWN, NOT A BUG — desktop browsers disagree about where you are. On one
   * machine in Jos, Chrome reported ~9.0/8.9 (correct) while Firefox reported
   * ~11/13, several hundred km away. Neither has a GPS: Chrome queries
   * Google's Wi-Fi/cell-tower database, while Firefox — since Mozilla retired
   * its own Location Service — falls back to IP geolocation, which resolves to
   * the ISP's nearest routing hub rather than the visitor. In Nigeria that is
   * routinely a whole state off; it is the same limitation that got the old
   * reverse-geocoding GeoLocationService disabled and then deleted.
   *
   * We pass through whatever the browser reports (no swap, no rounding), and
   * enableHighAccuracy below is only a hint — it cannot invent a GPS the
   * device lacks. The real device app goes through Capacitor and the hardware
   * GPS, where the engines converge, so this is a desktop-only artifact.
   *
   * If it ever needs mitigating: coords.accuracy is metres, and an IP-derived
   * fix reports something enormous (50km+) versus 20-100m for a Wi-Fi fix, so
   * a threshold there could reject a fix too coarse to mean anything. That was
   * a deliberate no for now — a wrong-but-confident result is the cost.
   */
  async enableNearby(): Promise<void> {
    if (this._nearbyLocating()) return;
    this._nearbyError.set(null);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this._nearbyError.set('unavailable');
      return;
    }

    this._nearbyLocating.set(true);
    const coords = await new Promise<NearbyCoords | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 },
      );
    });
    this._nearbyLocating.set(false);

    if (!coords) {
      this._nearbyError.set('denied');
      return;
    }

    this._filters.set({ location: '', search: '', category: '' });
    this._nearby.set(coords);
    this._page.set(1);
    this._refetch$.next();
  }

  /**
   * distanceKm for a row, or null outside nearby mode. Lets templates pass
   * [distanceKm] straight through without narrowing the union themselves.
   */
  distanceOf(item: ListingItem): number | null {
    return 'distanceKm' in item ? item.distanceKm : null;
  }

  /** Leaves nearby mode and returns to the (now unfiltered) normal listing. */
  disableNearby(): void {
    if (!this._nearby()) return;
    this._exitNearby();
    this._page.set(1);
    this._refetch$.next();
  }

  // Drops nearby mode WITHOUT refetching — callers above already refetch as
  // part of applying their own filter.
  private _exitNearby(): void {
    this._nearby.set(null);
    this._nearbyError.set(null);
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
    const { location, search, category } = this._filters();
    const nearby = this._nearby();
    this._cache.delete(
      nearby
        ? JSON.stringify({ nearby, page: this._page() })
        : JSON.stringify({ location, search, category, page: this._page() }),
    );
    this._refetch$.next();
  }

  goToPage(page: number): void {
    if (page < 1 || (this._meta() && page > this._meta()!.totalPages)) return;
    this._page.set(page);
    this._refetch$.next();
  }
}
