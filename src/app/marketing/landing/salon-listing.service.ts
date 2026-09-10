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

/**
 * Shared response cache for the page-scoped listing services.
 *
 * Filters and rendered results belong to each page instance, but identical
 * API results remain cached for the session and are cleared centrally on
 * logout. This preserves instant revisits without leaking active filters.
 */
@Injectable({ providedIn: 'root' })
export class SalonListingSessionCache implements Clearable {
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _pages = new Map<string, CachedPage>();

  constructor() {
    this._cacheRegistry.register(this);
  }

  get(key: string): CachedPage | undefined {
    return this._pages.get(key);
  }

  set(key: string, page: CachedPage): void {
    this._pages.set(key, page);
  }

  delete(key: string): void {
    this._pages.delete(key);
  }

  clear(): void {
    this._pages.clear();
  }
}

// Homepage salon listing — search/filter/pagination against GET /salons
// (public, no auth). Both the name search and the location filter are free
// text, so both are debounced; category and page changes go straight through.
//
// Location is a single fuzzy `location=` param spanning city/street/state/
// country, not the exact-match state=/city= pair it replaced — those missed
// real data ("JOS SOUTH" vs "Jos-South") and were disabled in the UI because
// of it. The backend handles typos and ranks by relevance.
@Injectable()
export class SalonListingService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _cache = inject(SalonListingSessionCache);

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
  // True while showing nearby results. Category and search both apply here and
  // narrow within the radius; only location does not, since a typed place
  // competes with the radius rather than refining it. The UI reflects the mode
  // by showing an active "Near me" state.
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
  // The key of the request currently in flight — see the subscribe below.
  private _pendingKey = '';

  constructor() {
    this._searchInput$
      .pipe(debounceTime(500), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((search) => {
        // Clears nothing. Search, location and category all AND together on
        // both endpoints — the backend applies each as its own andWhere — so
        // "Jeff", "Jos" and "nails" is a valid, answerable search.
        //
        // This used to wipe category on the grounds that the two "don't
        // combine", which was never true of the API; it just made the
        // combination unreachable from the UI.
        //
        // NEARBY IS THE ANCHOR: typing while it is active narrows within the
        // radius rather than leaving it, since the nearby endpoint takes the
        // term itself.
        this._filters.update((f) => ({ ...f, search }));
        // Not _exitNearby(): staying is the point. Only a stale error is
        // dropped, for the case where "Near me" was denied (so _nearby is
        // null but the banner is up) and the user typed instead.
        if (this._nearby() === null) this._nearbyError.set(null);
        this._page.set(1);
        this._refetch$.next();
      });

    // Location clears nothing either — see the search pipeline above. All
    // three text/chip filters AND together; "barbers in Jos" is one of the
    // combinations this makes reachable.
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
          // Nearby keys on the coordinates AND category AND search, since the
          // endpoint filters by all three. Location is the only one excluded:
          // it is cleared on entry and the endpoint has no param for it.
          // Leaving category or search out of the key would serve the previous
          // value's results straight back out of the cache on a change.
          const key = nearby
            ? JSON.stringify({ nearby, category, search, page: this._page() })
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
              // Both AND with the radius server-side: salons that are near AND
              // offer this category AND match the term. An unknown slug or an
              // unmatched term is an empty result, not an error — the mode
              // never silently widens back out to a nationwide search.
              category: category || undefined,
              search: search || undefined,
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
  //
  // Clears nothing and does NOT leave nearby mode: the nearby endpoint takes a
  // category of its own and ANDs it with the radius, and the normal listing
  // ANDs it with search/location. The pills are visible in nearby mode, so
  // tapping one dropping the user back to a nationwide listing was the
  // surprising behaviour.
  setCategory(category: string): void {
    this._filters.update((f) => ({ ...f, category }));
    this._page.set(1);
    this._refetch$.next();
  }

  /**
   * Switches to nearby results, asking the browser for the visitor's
   * coordinates. Nearby is the ANCHOR mode: the endpoint takes
   * lat/lng/category/search/page and ANDs category and search with the radius,
   * so both can be set and changed WITHOUT leaving.
   *
   * Carry-over on entry is narrower than that, deliberately. Category comes in
   * with the user; search does not, because typing a name means they knew
   * which salon they wanted and tapping Near me is the opposite intent.
   * Typing again once inside works normally.
   *
   * Location is cleared on entry and setting it drops back to the normal
   * listing — a typed place and a radius are two answers to one question.
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

    // CATEGORY survives entry; LOCATION and SEARCH do not.
    //
    // Category is a browse filter — "Nails" then Near me is one continuous
    // thought, and the endpoint takes it.
    //
    // Search is cleared even though the endpoint accepts it: typing a name
    // means the user already knows which salon they want, and tapping Near me
    // is the opposite intent. Carrying the term in would answer a question
    // they just stopped asking. It stays usable INSIDE nearby (see the search
    // pipeline) — it is only the carry-over on entry that is dropped.
    //
    // Location is cleared because a typed place and a radius are two competing
    // answers to the same question, and the endpoint has no param for it.
    this._filters.update((f) => ({ location: '', search: '', category: f.category }));
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
