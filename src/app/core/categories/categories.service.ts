import { CacheRegistry } from '../caching/cache-registry/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { CategoryResponseDto } from '../../api/models/category-response-dto';
import { categoriesControllerFindAll } from '../../api/fn/services/categories-controller-find-all';

// Backend-managed, fixed list (no create/edit/delete route) — safe to cache
// for the lifetime of the app session. Response is already sorted for display.
@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _categories = signal<CategoryResponseDto[]>([]);
  private readonly _loading = signal(false);
  private _loaded = false;

  readonly categories = this._categories.asReadonly();
  readonly loading = this._loading.asReadonly();

  load(): void {
    if (this._loaded || this._loading()) return;
    this._loading.set(true);
    categoriesControllerFindAll(this._http, this._apiConfig.rootUrl)
      .pipe(map((r) => r.body))
      .subscribe({
        next: (categories) => {
          this._categories.set(categories);
          this._loaded = true;
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      });
  }

  clear(): void {
    this._categories.set([]);
    this._loaded = false;
  }
}
