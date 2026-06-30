import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { salonMembershipControllerGetMyMembership } from '../../api/fn/staff/salon-membership-controller-get-my-membership';
import { SalonMembershipDto } from '../../api/models/salon-membership-dto';
import { Membership, SalonRole, SubscriptionStatus } from './membership.types';

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
      map((res) => this._toMembership(res.body)),
      tap((membership) => this._cache.set(salonId, membership)),
    );
  }

  // The generated DTO types `role` as `{}` (the backend's Swagger doesn't
  // declare the enum on that field), so we map explicitly rather than cast —
  // this is the single seam where the wire shape becomes the domain shape.
  private _toMembership(dto: SalonMembershipDto): Membership {
    return {
      salonId: dto.salonId,
      role: dto.role as unknown as SalonRole,
      isStaff: dto.isStaff,
      canManageSalon: dto.canManageSalon,
      canManageStaff: dto.canManageStaff,
      tier: dto.tier,
      isFrozen: dto.isFrozen,
      staffFrozen: dto.staffFrozen,
      status: dto.status as SubscriptionStatus,
      isTrialing: dto.isTrialing,
      trialEndsAt: dto.trialEndsAt,
      daysLeft: dto.daysLeft,
    };
  }

  getCached(salonId: string): Membership | null {
    return this._cache.get(salonId) ?? null;
  }

  invalidate(salonId: string): void {
    this._cache.delete(salonId);
  }

  invalidateAll(): void {
    this._cache.clear();
  }
}
