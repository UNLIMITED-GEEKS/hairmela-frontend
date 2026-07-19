import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { staffAppointmentsControllerGetStaffAppointments } from '../../../api/fn/queues/staff-appointments-controller-get-staff-appointments';
import { staffAppointmentsControllerGetSalonAppointments } from '../../../api/fn/queues/staff-appointments-controller-get-salon-appointments';
import { QueueEntry } from '../../../api/models/queue-entry';
import { OptimisticService } from '../../../core/caching/optimistic/optimistic.service';
import { CachedLoader } from '../../../core/caching/optimistic/cached-loader';
import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';

// One month's appointments, date-ranged (unpaginated, per the backend's
// from/to mode) and cached by "salonId:staffId:from:to" so paging back to a
// month already viewed this session never re-fetches. staffId is empty
// string for the salon-wide view — still a distinct cache key from any real
// staffId, so the two views never collide.
@Injectable({ providedIn: 'root' })
export class AppointmentsCalendarService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _optimistic = inject(OptimisticService);
  private readonly _cacheRegistry = inject(CacheRegistry);

  private readonly _cache = new Map<string, QueueEntry[]>();
  private readonly _entries = signal<QueueEntry[]>([]);

  private readonly _loader = new CachedLoader({
    signal: this._entries,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (key) => {
      const [salonId, staffId, from, to] = key.split(':');
      const request$ = staffId
        ? staffAppointmentsControllerGetStaffAppointments(this._http, this._apiConfig.rootUrl, {
            salonId,
            staffId,
            from,
            to,
          })
        : staffAppointmentsControllerGetSalonAppointments(this._http, this._apiConfig.rootUrl, {
            salonId,
            from,
            to,
          });
      return request$.pipe(map((res) => res.body.data ?? []));
    },
  });

  constructor() {
    this._cacheRegistry.register(this);
  }

  readonly entries = this._entries.asReadonly();
  readonly loading = this._loader.loading;
  readonly error = this._loader.error;

  /** salonId + optional staffId ('' for salon-wide) + inclusive YYYY-MM-DD range. */
  load(salonId: string, staffId: string, from: string, to: string): void {
    this._loader.load(this._key(salonId, staffId, from, to));
  }

  refresh(salonId: string, staffId: string, from: string, to: string): void {
    this._loader.refresh(this._key(salonId, staffId, from, to));
  }

  private _key(salonId: string, staffId: string, from: string, to: string): string {
    return `${salonId}:${staffId}:${from}:${to}`;
  }

  clear(): void {
    this._cache.clear();
    this._optimistic.reset(this._entries, []);
  }
}
