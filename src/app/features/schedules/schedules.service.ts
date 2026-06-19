import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { StaffSchedule } from '../../api/models/staff-schedule';
import { CreateScheduleDto } from '../../api/models/create-schedule-dto';
import { UpdateScheduleDto } from '../../api/models/update-schedule-dto';
import { schedulesControllerFindAll } from '../../api/fn/schedules/schedules-controller-find-all';
import { schedulesControllerCreate } from '../../api/fn/schedules/schedules-controller-create';
import { schedulesControllerUpdate } from '../../api/fn/schedules/schedules-controller-update';
import { schedulesControllerDelete } from '../../api/fn/schedules/schedules-controller-delete';

@Injectable({ providedIn: 'root' })
export class SchedulesService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);

  constructor() { this._cacheRegistry.register(this); }

  private readonly _cache = new Map<string, StaffSchedule[]>();
  private readonly _schedules = signal<StaffSchedule[]>([]);
  private readonly _loading = signal(false);
  private readonly _acting = signal(false);

  readonly schedules = this._schedules.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly acting = this._acting.asReadonly();

  private _key(salonId: string, staffId: string): string { return `${salonId}:${staffId}`; }

  load(salonId: string, staffId: string): void {
    const cached = this._cache.get(this._key(salonId, staffId));
    if (cached) { this._schedules.set(cached); return; }
    this._fetch(salonId, staffId);
  }

  refresh(salonId: string, staffId: string): void {
    this._cache.delete(this._key(salonId, staffId));
    this._fetch(salonId, staffId);
  }

  create(salonId: string, staffId: string, body: CreateScheduleDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    schedulesControllerCreate(this._http, this._apiConfig.rootUrl, { salonId, staffId, body }).subscribe({
      next: () => { this._acting.set(false); this.refresh(salonId, staffId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  update(salonId: string, staffId: string, scheduleId: string, body: UpdateScheduleDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    schedulesControllerUpdate(this._http, this._apiConfig.rootUrl, { salonId, staffId, scheduleId, body }).subscribe({
      next: () => { this._acting.set(false); this.refresh(salonId, staffId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  remove(salonId: string, staffId: string, scheduleId: string, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    schedulesControllerDelete(this._http, this._apiConfig.rootUrl, { salonId, staffId, scheduleId }).subscribe({
      next: () => { this._acting.set(false); this.refresh(salonId, staffId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  clear(): void {
    this._cache.clear();
    this._schedules.set([]);
  }

  private _fetch(salonId: string, staffId: string): void {
    this._loading.set(true);
    schedulesControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId, staffId }).subscribe({
      next: (res) => {
        this._cache.set(this._key(salonId, staffId), res.body);
        this._schedules.set(res.body);
        this._loading.set(false);
      },
      error: () => this._loading.set(false),
    });
  }
}
