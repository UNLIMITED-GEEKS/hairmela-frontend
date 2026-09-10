import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, map, of, switchMap } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { staffAppointmentsControllerGetStaffQueueEntryHistory } from '../../../api/fn/queues/staff-appointments-controller-get-staff-queue-entry-history';
import { staffAppointmentsControllerGetQueueEntryHistory } from '../../../api/fn/queues/staff-appointments-controller-get-queue-entry-history';
import { QueueEntry } from '../../../api/models/queue-entry';
import { OptimisticService } from '../../../core/caching/optimistic/optimistic.service';
import { CachedLoader } from '../../../core/caching/optimistic/cached-loader';
import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';

// One month's queue-entry history, cached by "salonId:staffId:from:to" so
// paging back to a viewed month is instant. The history endpoints include
// both appointments and walk-ins; the component decides which are visible.
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
      const requestPage = (page: number) =>
        staffId
          ? staffAppointmentsControllerGetStaffQueueEntryHistory(
              this._http,
              this._apiConfig.rootUrl,
              { salonId, staffId, from, to, page, limit: 100 },
            )
          : staffAppointmentsControllerGetQueueEntryHistory(this._http, this._apiConfig.rootUrl, {
              salonId,
              from,
              to,
              page,
              limit: 100,
            });

      return requestPage(1).pipe(
        switchMap((first) => {
          const firstPage = first.body.data ?? [];
          const totalPages = first.body.meta?.totalPages ?? 1;
          if (totalPages <= 1) return of(firstPage);

          const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) =>
            requestPage(index + 2),
          );
          return forkJoin(remainingPages).pipe(
            map((responses) => [
              ...firstPage,
              ...responses.flatMap((response) => response.body.data ?? []),
            ]),
          );
        }),
      );
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
