import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, shareReplay, map, catchError } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { publicServicesControllerFindBySalon } from '../../api/fn/services/public-services-controller-find-by-salon';
import { CacheRegistry, Clearable } from '../caching/cache-registry/cache-registry.service';

export interface ServiceOption {
  readonly id: string;
  readonly name: string;
  readonly duration?: number;
  readonly price?: string;
  /** Staff who perform this service — lets callers narrow to one barber. */
  readonly staffIds: readonly string[];
}

/**
 * A salon's active service list, fetched once per salon per session.
 *
 * The PUBLIC endpoint, deliberately: the reschedule dialog serves customers as
 * well as staff, and the staff-services route is staff-only (it 403s for a
 * customer on My History).
 *
 * Cached because the reschedule dialog needs this every time it opens, while a
 * salon's menu barely changes within a session — without it, opening and
 * closing the dialog refetches the same list each time. No TTL: this is a
 * catalogue, not live queue state (contrast SalonListingService's note on
 * isOpen badges). Registered with CacheRegistry so it is dropped on logout
 * rather than leaking one user's salons into the next session.
 *
 * In-flight requests are shared, so two dialogs opening at once make one call.
 */
@Injectable({ providedIn: 'root' })
export class SalonServicesCache implements Clearable {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  private readonly _bySalon = new Map<string, Observable<ServiceOption[]>>();

  constructor() {
    inject(CacheRegistry).register(this);
  }

  forSalon(salonId: string): Observable<ServiceOption[]> {
    if (!salonId) return of([]);

    const cached = this._bySalon.get(salonId);
    if (cached) return cached;

    const request$ = publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, {
      salonId,
    }).pipe(
      map((res) =>
        res.body
          .filter((svc) => svc.isActive)
          .map((svc) => ({
            id: svc.id,
            name: svc.name,
            duration: svc.duration,
            price: svc.price,
            staffIds: svc.assignedStaffIds,
          })),
      ),
      // A failed fetch must not be cached as an empty menu for the rest of the
      // session — drop it so the next open retries.
      catchError(() => {
        this._bySalon.delete(salonId);
        return of<ServiceOption[]>([]);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this._bySalon.set(salonId, request$);
    return request$;
  }

  clear(): void {
    this._bySalon.clear();
  }
}
