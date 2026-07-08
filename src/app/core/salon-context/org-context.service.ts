import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, of, map, tap, switchMap, shareReplay, catchError, firstValueFrom } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { organizationsControllerFindMine } from '../../api/fn/organizations/organizations-controller-find-mine';
import { subscriptionsControllerGetMine } from '../../api/fn/subscriptions/subscriptions-controller-get-mine';
import { Organization } from '../../api/models/organization';
import { EffectiveAccessDto } from '../../api/models/effective-access-dto';
import { CacheRegistry } from '../caching/cache-registry/cache-registry.service';

// A user owns at most one org (FRONTEND-TIER-HANDOFF §4a). This resolves and
// caches it once so the tier banner, the billing page, and orgOwnerGuard all
// read the same orgId instead of each re-fetching /organizations/mine. It also
// caches the org's effective access (salonLimit) so the dashboard's add-salon
// gate has the limit without its own fetch.
@Injectable({ providedIn: 'root' })
export class OrgContextService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _router = inject(Router);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _ownedOrg = signal<Organization | null>(null);
  private readonly _access = signal<EffectiveAccessDto | null>(null);
  readonly ownedOrg = this._ownedOrg.asReadonly();
  readonly access = this._access.asReadonly();

  private _inflight$: Observable<Organization | null> | null = null;

  // Resolves the user's owned org + its effective access, caching both. Returns
  // null if the user owns no org (pure customer / staff-only) or the call fails.
  ensureLoaded(): Observable<Organization | null> {
    if (this._ownedOrg()) return of(this._ownedOrg());
    if (this._inflight$) return this._inflight$;

    this._inflight$ = organizationsControllerFindMine(this._http, this._apiConfig.rootUrl).pipe(
      map((res) => (Array.isArray(res.body) && res.body.length > 0 ? res.body[0] : null)),
      tap((org) => {
        this._ownedOrg.set(org);
        // Don't cache a null result — a transient failure (or a not-yet-created
        // org) must not permanently pin the inflight observable to null, or
        // every later goToBilling() would replay the miss and fall to dashboard.
        if (!org) this._inflight$ = null;
      }),
      switchMap((org) => {
        if (!org) return of(null as Organization | null);
        return subscriptionsControllerGetMine(this._http, this._apiConfig.rootUrl, { orgId: org.id }).pipe(
          tap((res) => this._access.set(res.body)),
          map(() => org),
          catchError(() => of(org)),
        );
      }),
      catchError(() => {
        this._inflight$ = null;
        return of(null);
      }),
      shareReplay(1),
    );
    return this._inflight$;
  }

  // Navigate to the owner-only billing page, resolving the org on demand so the
  // destination is correct even before the eager ensureLoaded() has settled.
  // Falls back to /dashboard only when the user genuinely owns no org.
  async goToBilling(): Promise<void> {
    const org = this._ownedOrg() ?? (await firstValueFrom(this.ensureLoaded()));
    void this._router.navigate(org ? ['/org', org.id, 'billing'] : ['/dashboard']);
  }

  clear(): void {
    this._ownedOrg.set(null);
    this._access.set(null);
    this._inflight$ = null;
  }
}
