import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';
import { SessionRequestCache } from '../../../core/caching/session-request-cache';
import { ApiConfiguration } from '../../../api/api-configuration';
import { salonsControllerGetCustomers } from '../../../api/fn/salons/salons-controller-get-customers';
import { staffControllerFindStaffFavoritesSummary } from '../../../api/fn/staff/staff-controller-find-staff-favorites-summary';
import { staffControllerGetFavorites } from '../../../api/fn/staff/staff-controller-get-favorites';
import { staffFavoritesControllerGetMyFavoritedUsers } from '../../../api/fn/staff/staff-favorites-controller-get-my-favorited-users';
import { SalonFavoritedUserDto } from '../../../api/models/salon-favorited-user-dto';
import { StaffFavoritesSummaryDto } from '../../../api/models/staff-favorites-summary-dto';
import { StaffFavoritedUserDto } from '../../../api/models/staff-favorited-user-dto';
import { PaginatedMetaDto } from '../../../api/models/paginated-meta-dto';

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginatedMetaDto | null;
}

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  private readonly _salonCustomers = new SessionRequestCache<
    PaginatedResult<SalonFavoritedUserDto>
  >();
  private readonly _staffCustomers = new SessionRequestCache<
    PaginatedResult<StaffFavoritedUserDto>
  >();
  private readonly _summaries = new SessionRequestCache<StaffFavoritesSummaryDto[]>();

  constructor() {
    inject(CacheRegistry).register(this);
  }

  clear(): void {
    this._salonCustomers.clear();
    this._staffCustomers.clear();
    this._summaries.clear();
  }

  getSalonFavorites(
    salonId: string,
    page = 1,
    limit = 100,
    search?: string,
  ): Observable<PaginatedResult<SalonFavoritedUserDto>> {
    return this._salonCustomers.get(
      JSON.stringify(['salon', salonId, page, limit, search?.trim() || '']),
      () =>
        salonsControllerGetCustomers(this._http, this._apiConfig.rootUrl, {
          salonId,
          scope: 'salon',
          page,
          limit,
          search: search?.trim() || undefined,
        }).pipe(
          map((response) => ({ data: response.body.data ?? [], meta: response.body.meta ?? null })),
        ),
    );
  }

  getStaffFavoritesSummary(salonId: string): Observable<StaffFavoritesSummaryDto[]> {
    return this._summaries.get(JSON.stringify(['summary', salonId]), () =>
      staffControllerFindStaffFavoritesSummary(this._http, this._apiConfig.rootUrl, {
        salonId,
      }).pipe(map((response) => response.body ?? [])),
    );
  }

  getMyFavoritedUsers(
    page = 1,
    limit = 100,
    search?: string,
  ): Observable<PaginatedResult<StaffFavoritedUserDto>> {
    return this._staffCustomers.get(JSON.stringify(['my', page, limit, search?.trim() || '']), () =>
      staffFavoritesControllerGetMyFavoritedUsers(this._http, this._apiConfig.rootUrl, {
        page,
        limit,
        search: search?.trim() || undefined,
      }).pipe(
        map((response) => ({ data: response.body.data ?? [], meta: response.body.meta ?? null })),
      ),
    );
  }

  getStaffMemberFavorites(
    salonId: string,
    staffId: string,
    page = 1,
    limit = 100,
    search?: string,
  ): Observable<PaginatedResult<StaffFavoritedUserDto>> {
    return this._staffCustomers.get(
      JSON.stringify(['staff', salonId, staffId, page, limit, search?.trim() || '']),
      () =>
        staffControllerGetFavorites(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          page,
          limit,
          search: search?.trim() || undefined,
        }).pipe(
          map((response) => ({ data: response.body.data ?? [], meta: response.body.meta ?? null })),
        ),
    );
  }
}
