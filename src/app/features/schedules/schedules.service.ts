import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { map } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { StaffSchedule } from '../../api/models/staff-schedule';
import { CreateScheduleDto } from '../../api/models/create-schedule-dto';
import { UpdateScheduleDto } from '../../api/models/update-schedule-dto';
import { schedulesControllerFindAll } from '../../api/fn/schedules/schedules-controller-find-all';
import { schedulesControllerCreate } from '../../api/fn/schedules/schedules-controller-create';
import { schedulesControllerUpdate } from '../../api/fn/schedules/schedules-controller-update';
import { schedulesControllerDelete } from '../../api/fn/schedules/schedules-controller-delete';
import { OptimisticService } from '../../core/optimistic/optimistic.service';
import { CachedLoader } from '../../core/optimistic/cached-loader';

@Injectable({ providedIn: 'root' })
export class SchedulesService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _optimistic = inject(OptimisticService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _cache = new Map<string, StaffSchedule[]>();
  private readonly _schedules = signal<StaffSchedule[]>([]);

  private readonly _loader = new CachedLoader({
    signal: this._schedules,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (ctx) => {
      const colonIdx = ctx.indexOf(':');
      const salonId = ctx.slice(0, colonIdx);
      const staffId = ctx.slice(colonIdx + 1);
      return schedulesControllerFindAll(this._http, this._apiConfig.rootUrl, {
        salonId,
        staffId,
      }).pipe(map((r) => r.body));
    },
  });

  readonly schedules = this._schedules.asReadonly();
  readonly loading = this._loader.loading;
  readonly error = this._loader.error;

  private _key(salonId: string, staffId: string): string {
    return `${salonId}:${staffId}`;
  }

  load(salonId: string, staffId: string): void {
    this._loader.load(this._key(salonId, staffId));
  }

  refresh(salonId: string, staffId: string): void {
    this._loader.refresh(this._key(salonId, staffId));
  }

  create(salonId: string, staffId: string, body: CreateScheduleDto, onSuccess?: () => void): void {
    const ctx = this._key(salonId, staffId);
    const tempId = `temp_${crypto.randomUUID()}`;
    const optimisticRow = { id: tempId, ...body } as StaffSchedule;
    this._optimistic.run({
      signal: this._schedules,
      // apply is REPLAYED on every recompute (e.g. a concurrent load()'s
      // commitRead landing while this create is still pending) — must be
      // idempotent or a replay duplicates the row. Guard by tempId.
      apply: (list) => (list.some((s) => s.id === tempId) ? list : [...list, optimisticRow]),
      reconcile: (list, res) => list.map((s) => (s.id === tempId ? res.body : s)),
      tempId,
      dedupeKey: `SchedulesService.create:${ctx}:${body.dayOfWeek}:${body.startTime}`,
      mirror: this._loader.mirrorFn(ctx),
      contextKey: ctx,
      request: () =>
        schedulesControllerCreate(this._http, this._apiConfig.rootUrl, { salonId, staffId, body }),
      errorMessage: 'Could not add schedule. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
  }

  update(
    salonId: string,
    staffId: string,
    scheduleId: string,
    body: UpdateScheduleDto,
    onSuccess?: () => void,
  ): void {
    const ctx = this._key(salonId, staffId);
    this._optimistic.run({
      signal: this._schedules,
      dedupeKey: `SchedulesService.update:${scheduleId}`,
      apply: (list) => list.map((s) => (s.id === scheduleId ? { ...s, ...body } : s)),
      mirror: this._loader.mirrorFn(ctx),
      contextKey: ctx,
      targetId: scheduleId,
      request: () =>
        schedulesControllerUpdate(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          scheduleId,
          body,
        }),
      errorMessage: 'Could not update schedule. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
  }

  remove(salonId: string, staffId: string, scheduleId: string, onSuccess?: () => void): void {
    const ctx = this._key(salonId, staffId);
    this._optimistic.run({
      signal: this._schedules,
      apply: (list) => list.filter((s) => s.id !== scheduleId),
      mirror: this._loader.mirrorFn(ctx),
      dedupeKey: `SchedulesService.remove:${scheduleId}`,
      contextKey: ctx,
      targetId: scheduleId,
      request: () =>
        schedulesControllerDelete(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          scheduleId,
        }),
      errorMessage: 'Could not remove schedule. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  clear(): void {
    this._cache.clear();
    this._optimistic.reset(this._schedules, []);
  }
}
