import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap, finalize, share } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { salonMembershipControllerGetMyMembership } from '../../api/fn/staff/salon-membership-controller-get-my-membership';
import { SalonMembershipDto } from '../../api/models/salon-membership-dto';
import { Membership, SalonRole, SubscriptionStatus } from './membership.types';

@Injectable({ providedIn: 'root' })
export class MembershipStore {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _cache = new Map<string, Membership>();
  // Tracks requests currently in flight so concurrent callers for the same
  // salon (e.g. SalonContextService's activeSalonId + displaySalonId
  // bindings, which are usually the same id) share one HTTP call instead of
  // each firing their own. Cleared as soon as the request settles — only
  // resolved values live in `_cache` afterward.
  private readonly _inflight = new Map<string, Observable<Membership>>();

  getMembership(salonId: string): Observable<Membership> {
    const cached = this._cache.get(salonId);
    if (cached) {
      return new Observable((observer) => {
        observer.next(cached);
        observer.complete();
      });
    }

    const pending = this._inflight.get(salonId);
    if (pending) return pending;

    const request$ = salonMembershipControllerGetMyMembership(
      this._http,
      this._apiConfig.rootUrl,
      { salonId },
    ).pipe(
      map((res) => this._toMembership(res.body)),
      tap((membership) => this._cache.set(salonId, membership)),
      finalize(() => this._inflight.delete(salonId)),
      share(),
    );

    this._inflight.set(salonId, request$);
    return request$;
  }

  // The generated DTO types `role` as `{}` (the backend's Swagger doesn't
  // declare the enum on that field), so we map explicitly rather than cast —
  // this is the single seam where the wire shape becomes the domain shape.
  private _toMembership(dto: SalonMembershipDto): Membership {
    return {
      salonId: dto.salonId,
      orgId: dto.orgId,
      role: dto.role as unknown as SalonRole,
      isStaff: dto.isStaff,
      staffId: dto.staffId,
      currency: dto.currency,
      queueId: dto.queueId,
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

  // Seeds the cache directly from a membership DTO the caller already has —
  // e.g. the create-salon response now returns the creator's membership
  // inline, so there's no need to immediately re-fetch what the backend just
  // handed us. Uses the same DTO→domain mapping as a real fetch.
  setFromDto(dto: SalonMembershipDto): void {
    this._cache.set(dto.salonId, this._toMembership(dto));
  }

  invalidate(salonId: string): void {
    this._cache.delete(salonId);
  }

  invalidateAll(): void {
    this._cache.clear();
  }
}
