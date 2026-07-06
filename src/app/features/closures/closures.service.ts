import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { retry } from 'rxjs';
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
import { OptimisticService, ReadToken } from '../../core/optimistic/optimistic.service';

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
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _inflight = new Set<string>();

  readonly salonClosures = this._salonClosures.asReadonly();
  readonly staffClosures = this._staffClosures.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  loadSalon(salonId: string): void {
    const token = this._optimistic.beginRead(this._salonClosures, salonId);
    const cached = this._salonCache.get(salonId);
    if (cached) {
      this._optimistic.commitRead(this._salonClosures, cached, token, (v) =>
        this._salonCache.set(salonId, v),
      );
      return;
    }
    if (this._inflight.has(salonId)) return;
    this._fetchSalon(salonId, token);
  }

  loadStaff(salonId: string, staffId: string): void {
    const ctx = `${salonId}:${staffId}`;
    const token = this._optimistic.beginRead(this._staffClosures, ctx);
    const cached = this._staffCache.get(ctx);
    if (cached) {
      this._optimistic.commitRead(this._staffClosures, cached, token, (v) =>
        this._staffCache.set(ctx, v),
      );
      return;
    }
    if (this._inflight.has(ctx)) return;
    this._fetchStaff(salonId, staffId, token);
  }

  refreshSalon(salonId: string): void {
    const token = this._optimistic.beginRead(this._salonClosures, salonId);
    this._salonCache.delete(salonId);
    this._fetchSalon(salonId, token);
  }

  refreshStaff(salonId: string, staffId: string): void {
    const ctx = `${salonId}:${staffId}`;
    const token = this._optimistic.beginRead(this._staffClosures, ctx);
    this._staffCache.delete(ctx);
    this._fetchStaff(salonId, staffId, token);
  }

  createSalon(salonId: string, body: CreateClosureDto, onSuccess?: () => void): void {
    const tempId = `temp_${crypto.randomUUID()}`;
    const optimisticRow = { id: tempId, date: body.date, reason: body.reason ?? null } as Closure;
    this._optimistic.run({
      signal: this._salonClosures,
      apply: (list) => [...list, optimisticRow],
      reconcile: (list, res) => list.map((c) => (c.id === tempId ? res.body : c)),
      tempId,
      mirror: (v) => this._salonCache.set(salonId, v),
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
      apply: (list) => [...list, optimisticRow],
      reconcile: (list, res) => list.map((c) => (c.id === tempId ? res.body : c)),
      tempId,
      mirror: (v) => this._staffCache.set(ctx, v),
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
    if (this._optimistic.isPending(closureId)) return;
    this._optimistic.run({
      signal: this._salonClosures,
      apply: (list) => list.filter((c) => c.id !== closureId),
      mirror: (v) => this._salonCache.set(salonId, v),
      contextKey: salonId,
      request: () =>
        salonClosuresControllerDelete(this._http, this._apiConfig.rootUrl, { salonId, closureId }),
      errorMessage: 'Could not delete closure. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  deleteStaff(salonId: string, staffId: string, closureId: string, onSuccess?: () => void): void {
    const ctx = `${salonId}:${staffId}`;
    if (this._optimistic.isPending(closureId)) return;
    this._optimistic.run({
      signal: this._staffClosures,
      apply: (list) => list.filter((c) => c.id !== closureId),
      mirror: (v) => this._staffCache.set(ctx, v),
      contextKey: ctx,
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
    this._salonClosures.set([]);
    this._staffClosures.set([]);
  }

  private _fetchSalon(salonId: string, token: ReadToken): void {
    this._inflight.add(salonId);
    this._loading.set(true);
    this._error.set(false);
    salonClosuresControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight.delete(salonId);
          this._salonCache.set(salonId, res.body);
          this._optimistic.commitRead(this._salonClosures, res.body, token, (v) =>
            this._salonCache.set(salonId, v),
          );
          this._loading.set(false);
        },
        error: () => {
          this._inflight.delete(salonId);
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }

  private _fetchStaff(salonId: string, staffId: string, token: ReadToken): void {
    const ctx = `${salonId}:${staffId}`;
    this._inflight.add(ctx);
    this._loading.set(true);
    this._error.set(false);
    staffClosuresControllerFindAll(this._http, this._apiConfig.rootUrl, {
      salonId,
      staffId,
    })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight.delete(ctx);
          this._staffCache.set(ctx, res.body);
          this._optimistic.commitRead(this._staffClosures, res.body, token, (v) =>
            this._staffCache.set(ctx, v),
          );
          this._loading.set(false);
        },
        error: () => {
          this._inflight.delete(ctx);
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }
}
