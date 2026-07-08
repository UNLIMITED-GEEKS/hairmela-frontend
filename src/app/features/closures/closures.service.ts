import { CacheRegistry } from '../../core/caching/cache-registry/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { map } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { Closure } from '../../api/models/closure';
import { CreateClosureDto } from '../../api/models/create-closure-dto';
import { salonClosuresControllerFindAll } from '../../api/fn/schedules/salon-closures-controller-find-all';
import { salonClosuresControllerCreate } from '../../api/fn/schedules/salon-closures-controller-create';
import { salonClosuresControllerDelete } from '../../api/fn/schedules/salon-closures-controller-delete';
import { staffClosuresControllerFindAll } from '../../api/fn/schedules/staff-closures-controller-find-all';
import { staffClosuresControllerCreate } from '../../api/fn/schedules/staff-closures-controller-create';
import { staffClosuresControllerDelete } from '../../api/fn/schedules/staff-closures-controller-delete';
import { OptimisticService } from '../../core/caching/optimistic/optimistic.service';
import { CachedLoader } from '../../core/caching/optimistic/cached-loader';

@Injectable({ providedIn: 'root' })
export class ClosuresService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _optimistic = inject(OptimisticService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _salonCache = new Map<string, Closure[]>();
  private readonly _staffCache = new Map<string, Closure[]>();

  private readonly _salonClosures = signal<Closure[]>([]);
  private readonly _staffClosures = signal<Closure[]>([]);

  private readonly _salonLoader = new CachedLoader({
    signal: this._salonClosures,
    optimistic: this._optimistic,
    cache: this._salonCache,
    fetch: (salonId) =>
      salonClosuresControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId }).pipe(
        map((r) => r.body),
      ),
  });

  private readonly _staffLoader = new CachedLoader({
    signal: this._staffClosures,
    optimistic: this._optimistic,
    cache: this._staffCache,
    fetch: (ctx) => {
      const colonIdx = ctx.indexOf(':');
      const salonId = ctx.slice(0, colonIdx);
      const staffId = ctx.slice(colonIdx + 1);
      return staffClosuresControllerFindAll(this._http, this._apiConfig.rootUrl, {
        salonId,
        staffId,
      }).pipe(map((r) => r.body));
    },
  });

  readonly salonClosures = this._salonClosures.asReadonly();
  readonly staffClosures = this._staffClosures.asReadonly();
  readonly salonLoading = this._salonLoader.loading;
  readonly salonError = this._salonLoader.error;
  readonly staffLoading = this._staffLoader.loading;
  readonly staffError = this._staffLoader.error;

  loadSalon(salonId: string): void {
    this._salonLoader.load(salonId);
  }

  loadStaff(salonId: string, staffId: string): void {
    this._staffLoader.load(`${salonId}:${staffId}`);
  }

  refreshSalon(salonId: string): void {
    this._salonLoader.refresh(salonId);
  }

  refreshStaff(salonId: string, staffId: string): void {
    this._staffLoader.refresh(`${salonId}:${staffId}`);
  }

  createSalon(salonId: string, body: CreateClosureDto, onSuccess?: () => void): void {
    const tempId = `temp_${crypto.randomUUID()}`;
    const optimisticRow = { id: tempId, date: body.date, reason: body.reason ?? null } as Closure;
    this._optimistic.run({
      signal: this._salonClosures,
      apply: (list) => (list.some((c) => c.id === tempId) ? list : [...list, optimisticRow]),
      reconcile: (list, res) => list.map((c) => (c.id === tempId ? res.body : c)),
      tempId,
      dedupeKey: `ClosuresService.createSalon:${salonId}:${body.date}`,
      mirror: this._salonLoader.mirrorFn(salonId),
      contextKey: salonId,
      request: () =>
        salonClosuresControllerCreate(this._http, this._apiConfig.rootUrl, { salonId, body }),
      errorMessage: 'Could not add closure. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
  }

  createStaff(
    salonId: string,
    staffId: string,
    body: CreateClosureDto,
    onSuccess?: () => void,
  ): void {
    const ctx = `${salonId}:${staffId}`;
    const tempId = `temp_${crypto.randomUUID()}`;
    const optimisticRow = { id: tempId, date: body.date, reason: body.reason ?? null } as Closure;
    this._optimistic.run({
      signal: this._staffClosures,
      apply: (list) => (list.some((c) => c.id === tempId) ? list : [...list, optimisticRow]),
      reconcile: (list, res) => list.map((c) => (c.id === tempId ? res.body : c)),
      tempId,
      dedupeKey: `ClosuresService.createStaff:${ctx}:${body.date}`,
      mirror: this._staffLoader.mirrorFn(ctx),
      contextKey: ctx,
      request: () =>
        staffClosuresControllerCreate(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          body,
        }),
      errorMessage: 'Could not add closure. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
  }

  deleteSalon(salonId: string, closureId: string, onSuccess?: () => void): void {
    this._optimistic.run({
      signal: this._salonClosures,
      dedupeKey: `ClosuresService.deleteSalon:${closureId}`,
      apply: (list) => list.filter((c) => c.id !== closureId),
      mirror: this._salonLoader.mirrorFn(salonId),
      contextKey: salonId,
      targetId: closureId,
      request: () =>
        salonClosuresControllerDelete(this._http, this._apiConfig.rootUrl, { salonId, closureId }),
      errorMessage: 'Could not delete closure. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  deleteStaff(salonId: string, staffId: string, closureId: string, onSuccess?: () => void): void {
    const ctx = `${salonId}:${staffId}`;
    this._optimistic.run({
      signal: this._staffClosures,
      dedupeKey: `ClosuresService.deleteStaff:${closureId}`,
      apply: (list) => list.filter((c) => c.id !== closureId),
      mirror: this._staffLoader.mirrorFn(ctx),
      contextKey: ctx,
      targetId: closureId,
      request: () =>
        staffClosuresControllerDelete(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          closureId,
        }),
      errorMessage: 'Could not delete closure. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  clear(): void {
    this._salonCache.clear();
    this._staffCache.clear();
    this._optimistic.reset(this._salonClosures, []);
    this._optimistic.reset(this._staffClosures, []);
  }
}
