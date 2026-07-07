import { CacheRegistry } from '../../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { map } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { staffControllerFindAll } from '../../../api/fn/staff/staff-controller-find-all';
import { OptimisticService } from '../../../core/optimistic/optimistic.service';
import { CachedLoader } from '../../../core/optimistic/cached-loader';

@Injectable({ providedIn: 'root' })
export class StaffServiceAssignService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _optimistic = inject(OptimisticService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  // Unused by the component today (it reads assignment state from
  // ServicesService.staffServices() instead) — left in place as-is.
  private readonly _assignedIds = signal<Set<string>>(new Set());

  // defaultServiceId lives on the staff record (StaffWithQueueDto), so it's
  // fetched via staffControllerFindAll, not the staff-services endpoint.
  private readonly _cache = new Map<string, string | null>();
  private readonly _defaultServiceId = signal<string | null>(null);

  private readonly _loader = new CachedLoader({
    signal: this._defaultServiceId,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (ctx) => {
      const colonIdx = ctx.indexOf(':');
      const salonId = ctx.slice(0, colonIdx);
      const staffId = ctx.slice(colonIdx + 1);
      return staffControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId }).pipe(
        map((r) => r.body.find((s) => s.staff.id === staffId)?.staff.defaultServiceId ?? null),
      );
    },
    // No shouldCache guard here: null is a legitimate fetched value (staff
    // with no default service set yet), not an "unloaded" sentinel — it must
    // be cached like any other result, or every load() for that staff member
    // refetches forever.
  });

  readonly assignedIds = this._assignedIds.asReadonly();
  readonly defaultServiceId = this._defaultServiceId.asReadonly();
  readonly loading = this._loader.loading;
  readonly error = this._loader.error;

  // Called for the local optimistic set + its revert-on-failure (see
  // StaffServiceAssignComponent.setDefault). Writes through to the cache too,
  // so a later load() for this salon/staff doesn't serve a stale cached value
  // over this — same write-through discipline as CachedLoader.mirrorFn.
  setDefaultServiceId(salonId: string, staffId: string, id: string | null): void {
    this._defaultServiceId.set(id);
    this._cache.set(this._key(salonId, staffId), id);
  }

  setAssigned(ids: Set<string>): void {
    this._assignedIds.set(ids);
  }

  updateAssigned(updater: (ids: Set<string>) => Set<string>): void {
    this._assignedIds.update(updater);
  }

  private _key(salonId: string, staffId: string): string {
    return `${salonId}:${staffId}`;
  }

  load(salonId: string, staffId: string): void {
    this._loader.load(this._key(salonId, staffId));
  }

  refresh(salonId: string, staffId: string): void {
    this._loader.refresh(this._key(salonId, staffId));
  }

  clear(): void {
    this._cache.clear();
    this._optimistic.reset(this._defaultServiceId, null);
  }
}
