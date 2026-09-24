import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CacheRegistry } from '../../core/caching/cache-registry/cache-registry.service';
import { SalonListingState } from '../../marketing/landing/salon-listing.service';
import { SearchPageStateStore } from './search-page-state.store';

describe('SearchPageStateStore', () => {
  it('restores each search route once without mixing auth and guest state', () => {
    TestBed.configureTestingModule({ providers: [SearchPageStateStore, CacheRegistry] });
    const store = TestBed.inject(SearchPageStateStore);
    const state: SalonListingState = {
      filters: { search: 'cuts', location: '', category: 'haircut' },
      page: 2,
      nearby: { lat: 9.9, lng: 8.9 },
    };

    store.save('/search', state);

    expect(store.take('/g/search')).toBeNull();
    expect(store.take('/search')).toEqual(state);
    expect(store.take('/search')).toBeNull();
  });
});
