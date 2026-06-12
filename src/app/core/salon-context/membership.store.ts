import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { salonMembershipControllerGetMyMembership } from '../../api/fn/staff/salon-membership-controller-get-my-membership';
import { Membership } from './membership.types';

@Injectable({ providedIn: 'root' })
export class MembershipStore {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _cache = new Map<string, Membership>();

  getMembership(salonId: string): Observable<Membership> {
    const cached = this._cache.get(salonId);
    if (cached) {
      return new Observable((observer) => {
        observer.next(cached);
        observer.complete();
      });
    }

    return salonMembershipControllerGetMyMembership(
      this._http,
      this._apiConfig.rootUrl,
      { salonId },
    ).pipe(
      map((res) => res.body as Membership),
      tap((membership) => this._cache.set(salonId, membership)),
    );
  }

  invalidate(salonId: string): void {
    this._cache.delete(salonId);
  }

  invalidateAll(): void {
    this._cache.clear();
  }
}
