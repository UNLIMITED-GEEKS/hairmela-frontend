import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { userFavoritesControllerFindMyFavorites } from '../../api/fn/salons/user-favorites-controller-find-my-favorites';
import { userSalonsControllerAddFavorite } from '../../api/fn/salons/user-salons-controller-add-favorite';
import { userSalonsControllerRemoveFavorite } from '../../api/fn/salons/user-salons-controller-remove-favorite';
import { SalonListingItemDto } from '../../api/models/salon-listing-item-dto';
import { PaginatedMetaDto } from '../../api/models/paginated-meta-dto';
import { CacheRegistry } from '../cache-registry.service';
import { ToastService } from '../toast/toast.service';

// Root-scoped, cached favourites state. The listing card DTO carries no
// isFavorited flag, so heart state on ANY card (homepage, detail page,
// favourites page) is derived from favoritedIds here — loaded once, shared
// everywhere. toggle() updates this cache in place (optimistic), and also
// patches the favourites-list cache directly rather than refetching, so the
// favourites page reflects a toggle made from any other page instantly.
@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _toast = inject(ToastService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _favoritedIds = signal<Set<string>>(new Set());
  private readonly _favoritedIdsLoaded = signal(false);
  private _idsInflight$: Promise<void> | null = null;

  // The favourites LIST page's own cache (full card data, paginated).
  private readonly _list = signal<SalonListingItemDto[]>([]);
  private readonly _meta = signal<PaginatedMetaDto | null>(null);
  private readonly _listLoading = signal(false);
  private _listLoadedPage: number | null = null;

  readonly favoritedIds = this._favoritedIds.asReadonly();
  readonly list = this._list.asReadonly();
  readonly meta = this._meta.asReadonly();
  readonly listLoading = this._listLoading.asReadonly();

  isFavorited(salonId: string): boolean {
    return this._favoritedIds().has(salonId);
  }

  // Ensures favoritedIds is populated at least once (page 1, enough to know
  // "is this salon favourited" for hearts elsewhere in the app). Cheap no-op
  // on repeat calls once loaded.
  async ensureIdsLoaded(): Promise<void> {
    if (this._favoritedIdsLoaded()) return;
    if (this._idsInflight$) return this._idsInflight$;

    this._idsInflight$ = this._fetchPage(1, 50)
      .then((res) => {
        this._favoritedIds.set(new Set((res.data ?? []).map((s) => s.id)));
        this._favoritedIdsLoaded.set(true);
      })
      .finally(() => {
        this._idsInflight$ = null;
      });
    return this._idsInflight$;
  }

  // Loads a page for the favourites LIST page itself. Cached per page number
  // (deliberately minimal — no LRU machinery, matches the project's caching
  // policy elsewhere) and skipped on repeat navigation to the same page.
  loadPage(page: number, limit = 20): void {
    if (this._listLoadedPage === page && !this._listLoading()) return;
    this._listLoading.set(true);
    this._fetchPage(page, limit)
      .then((res) => {
        const items = res.data ?? [];
        this._list.set(items);
        this._meta.set(res.meta ?? null);
        this._listLoadedPage = page;
        // Merge (not replace) — a page only tells us about ITS salons; other
        // pages' favourited ids must stay intact for hearts shown elsewhere.
        this._favoritedIds.update((ids) => {
          const next = new Set(ids);
          items.forEach((s) => next.add(s.id));
          return next;
        });
        this._favoritedIdsLoaded.set(true);
      })
      .finally(() => this._listLoading.set(false));
  }

  // Optimistic toggle: flip the heart immediately, patch every cache in
  // place, fire the request, and only revert if it genuinely fails.
  toggle(salon: Pick<SalonListingItemDto, 'id'> | SalonListingItemDto): void {
    const wasFavorited = this.isFavorited(salon.id);
    this._setFavorited(salon.id, !wasFavorited);

    // Removing never needs card data — just drop it from whatever list is
    // cached so the favourites page updates without a refetch.
    if (wasFavorited) {
      this._list.update((items) => items.filter((s) => s.id !== salon.id));
    } else if ('slug' in salon) {
      // Adding, and the caller has the full card (listing/favourites page) —
      // splice it in directly, no refetch needed.
      this._list.update((items) =>
        items.some((s) => s.id === salon.id) ? items : [salon as SalonListingItemDto, ...items],
      );
    } else {
      // Adding, but the caller only has an id (e.g. the salon detail page,
      // which has a different DTO shape with no address/photoUrl/isOpen to
      // splice in safely). Invalidate the list cache so the next loadPage()
      // does a real refetch instead of silently missing this favourite.
      this._listLoadedPage = null;
    }

    const call$ = wasFavorited
      ? userSalonsControllerRemoveFavorite(this._http, this._apiConfig.rootUrl, { salonId: salon.id })
      : userSalonsControllerAddFavorite(this._http, this._apiConfig.rootUrl, { salonId: salon.id });

    firstValueFrom(call$).catch(() => {
      // Revert on genuine failure only (network/server error) — both API
      // calls are idempotent server-side, so a retry-by-toggling-again is safe.
      this._setFavorited(salon.id, wasFavorited);
      this._toast.error('Could not update favourites — please try again.');
    });
  }

  clear(): void {
    this._favoritedIds.set(new Set());
    this._favoritedIdsLoaded.set(false);
    this._idsInflight$ = null;
    this._list.set([]);
    this._meta.set(null);
    this._listLoadedPage = null;
  }

  private _setFavorited(salonId: string, favorited: boolean): void {
    this._favoritedIds.update((ids) => {
      const next = new Set(ids);
      if (favorited) next.add(salonId);
      else next.delete(salonId);
      return next;
    });
  }

  private async _fetchPage(
    page: number,
    limit: number,
  ): Promise<{ data?: SalonListingItemDto[]; meta?: PaginatedMetaDto }> {
    const res = await firstValueFrom(
      userFavoritesControllerFindMyFavorites(this._http, this._apiConfig.rootUrl, { page, limit }),
    );
    return res.body;
  }
}
