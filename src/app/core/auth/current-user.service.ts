import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, finalize, map, of, shareReplay, tap } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { authenticatedAuthControllerGetMe } from '../../api/fn/auth/authenticated-auth-controller-get-me';
import { UserResponseDto } from '../../api/models/user-response-dto';
import { CacheRegistry, Clearable } from '../caching/cache-registry/cache-registry.service';
import { CurrentUserStore } from './current-user.store';

/**
 * Owns hydration of the signed-in user's identity.
 *
 * Guards and startup code must share this loader instead of issuing their own
 * /auth/me requests. That gives authenticated routing one source of truth and
 * prevents cold-start guards from evaluating ownership against a null user.
 */
@Injectable({ providedIn: 'root' })
export class CurrentUserService implements Clearable {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _store = inject(CurrentUserStore);
  private readonly _cacheRegistry = inject(CacheRegistry);

  private _inflight$: Observable<UserResponseDto> | null = null;
  private _generation = 0;

  constructor() {
    this._cacheRegistry.register(this);
  }

  ensureLoaded(): Observable<UserResponseDto> {
    const user = this._store.user();
    if (user) return of(user);
    return this._inflight$ ?? this._load();
  }

  refresh(): Observable<UserResponseDto> {
    return this._load();
  }

  clear(): void {
    this._generation += 1;
    this._inflight$ = null;
    this._store.clear();
  }

  private _load(): Observable<UserResponseDto> {
    const generation = ++this._generation;
    let request$: Observable<UserResponseDto>;

    request$ = authenticatedAuthControllerGetMe(this._http, this._apiConfig.rootUrl).pipe(
      map((response) => response.body),
      tap((user) => {
        if (this._generation === generation) this._store.set(user);
      }),
      finalize(() => {
        if (this._inflight$ === request$) this._inflight$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this._inflight$ = request$;
    return request$;
  }
}
