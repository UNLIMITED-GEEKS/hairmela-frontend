import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { salonsControllerGetFavorites } from '../../../api/fn/salons/salons-controller-get-favorites';
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

  async getSalonFavorites(
    salonId: string,
    page = 1,
    limit = 100,
    search?: string,
  ): Promise<PaginatedResult<SalonFavoritedUserDto>> {
    const res = await firstValueFrom(
      salonsControllerGetFavorites(this._http, this._apiConfig.rootUrl, {
        salonId,
        scope: 'salon',
        page,
        limit,
        search: search?.trim() || undefined,
      }),
    );
    return {
      data: res.body.data ?? [],
      meta: res.body.meta ?? null,
    };
  }

  async getStaffFavoritesSummary(salonId: string): Promise<StaffFavoritesSummaryDto[]> {
    const res = await firstValueFrom(
      staffControllerFindStaffFavoritesSummary(this._http, this._apiConfig.rootUrl, {
        salonId,
      }),
    );
    return res.body ?? [];
  }

  async getMyFavoritedUsers(
    page = 1,
    limit = 100,
    search?: string,
  ): Promise<PaginatedResult<StaffFavoritedUserDto>> {
    const res = await firstValueFrom(
      staffFavoritesControllerGetMyFavoritedUsers(this._http, this._apiConfig.rootUrl, {
        page,
        limit,
        search: search?.trim() || undefined,
      }),
    );
    return {
      data: res.body.data ?? [],
      meta: res.body.meta ?? null,
    };
  }

  async getStaffMemberFavorites(
    salonId: string,
    staffId: string,
    page = 1,
    limit = 100,
    search?: string,
  ): Promise<PaginatedResult<StaffFavoritedUserDto>> {
    const res = await firstValueFrom(
      staffControllerGetFavorites(this._http, this._apiConfig.rootUrl, {
        salonId,
        staffId,
        page,
        limit,
        search: search?.trim() || undefined,
      }),
    );
    return {
      data: res.body.data ?? [],
      meta: res.body.meta ?? null,
    };
  }
}

