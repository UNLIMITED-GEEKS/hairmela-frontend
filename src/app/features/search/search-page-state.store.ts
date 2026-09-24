import { Injectable, inject } from '@angular/core';
import { SalonListingState } from '../../marketing/landing/salon-listing.service';
import { CacheRegistry, Clearable } from '../../core/caching/cache-registry/cache-registry.service';

/**
 * Keeps the search page's active filters while a salon profile is open.
 *
 * This is deliberately memory-only and one-shot: browser back restores the
 * page, while a reload starts clean and precise nearby coordinates are never
 * written to storage or the URL.
 */
@Injectable({ providedIn: 'root' })
export class SearchPageStateStore implements Clearable {
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _states = new Map<string, SalonListingState>();

  constructor() {
    this._cacheRegistry.register(this);
  }

  save(key: string, state: SalonListingState): void {
    this._states.set(key, state);
  }

  take(key: string): SalonListingState | null {
    const state = this._states.get(key) ?? null;
    this._states.delete(key);
    return state;
  }

  clear(): void {
    this._states.clear();
  }
}
