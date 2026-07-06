import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, map, retry } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { staffServicesControllerGetStaffServices } from '../../../api/fn/services/staff-services-controller-get-staff-services';
import { staffControllerFindAll } from '../../../api/fn/staff/staff-controller-find-all';

@Injectable({ providedIn: 'root' })
export class StaffServiceAssignService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  private readonly _assignedIds = signal<Set<string>>(new Set());
  private readonly _defaultServiceId = signal<string | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);

  readonly assignedIds = this._assignedIds.asReadonly();
  readonly defaultServiceId = this._defaultServiceId.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  setDefaultServiceId(id: string | null): void {
    this._defaultServiceId.set(id);
  }

  setAssigned(ids: Set<string>): void {
    this._assignedIds.set(ids);
  }

  updateAssigned(updater: (ids: Set<string>) => Set<string>): void {
    this._assignedIds.update(updater);
  }

  load(salonId: string, staffId: string): void {
    this._loading.set(true);
    this._error.set(false);
    forkJoin({
      assigned: staffServicesControllerGetStaffServices(this._http, this._apiConfig.rootUrl, {
        salonId, staffId,
      }).pipe(map((r) => r.body)),
      staffList: staffControllerFindAll(this._http, this._apiConfig.rootUrl, {
        salonId,
      }).pipe(map((r) => r.body)),
    })
      .pipe(retry(1))
      .subscribe({
        next: ({ assigned, staffList }) => {
          this._assignedIds.set(new Set((assigned ?? []).map((ss) => ss.serviceId)));
          const staffRecord = staffList.find((s) => s.staff.id === staffId);
          this._defaultServiceId.set(staffRecord?.staff.defaultServiceId ?? null);
          this._loading.set(false);
        },
        error: () => {
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }
}
