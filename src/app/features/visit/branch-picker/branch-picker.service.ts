import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';
import { publicSalonsControllerFindBranchesBySlug } from '../../../api/fn/salons/public-salons-controller-find-branches-by-slug';
import { SalonBranchPickerDto } from '../../../api/models/salon-branch-picker-dto';

// Cached for the session, no expiry — which branches belong to a root rarely
// changes, unlike Analytics' filter-combination data. Cleared on logout via
// CacheRegistry, and per-slug by invalidate() after an in-app attach/detach
// (the only way branch membership changes without a reload).
@Injectable({ providedIn: 'root' })
export class BranchPickerService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _destroyRef = inject(DestroyRef);

  constructor() {
    this._cacheRegistry.register(this);
  }

  readonly loading = signal(true);
  readonly picker = signal<SalonBranchPickerDto | null>(null);
  readonly failed = signal(false);

  private readonly _cache = new Map<string, SalonBranchPickerDto>();

  // Which slug the UI is currently showing. Every async write below checks
  // this before landing, so a slow response for a slug the user has already
  // navigated away from can't overwrite the newer one — same guard pattern as
  // SalonVisitService's _activeQueueId.
  private _activeSlug: string | null = null;

  load(slug: string): void {
    this._activeSlug = slug;

    const cached = this._cache.get(slug);
    if (cached) {
      this.picker.set(cached);
      this.failed.set(false);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.failed.set(false);
    this.picker.set(null);
    publicSalonsControllerFindBranchesBySlug(this._http, this._apiConfig.rootUrl, { slug })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          // Cache regardless of whether this slug is still displayed — the
          // response is valid for its own slug either way.
          this._cache.set(slug, res.body);
          if (this._activeSlug !== slug) return;
          this.picker.set(res.body);
          this.loading.set(false);
        },
        error: () => {
          if (this._activeSlug !== slug) return;
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }

  // Drops one slug's cached branches so the next visit refetches — call after
  // attaching/detaching a branch, which changes what this page should show.
  invalidate(slug: string): void {
    this._cache.delete(slug);
  }

  clear(): void {
    this._cache.clear();
    this._activeSlug = null;
    this.picker.set(null);
    this.failed.set(false);
  }
}
