import { CacheRegistry } from '../../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, forkJoin, map, throwError } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Salon } from '../../../api/models/salon';
import { UpdateSalonDto } from '../../../api/models/update-salon-dto';
import { UpdateSalonSettingsDto } from '../../../api/models/update-salon-settings-dto';
import { UpdateSlugDto } from '../../../api/models/update-slug-dto';
import { salonsControllerFindOne } from '../../../api/fn/salons/salons-controller-find-one';
import { salonsControllerUpdate } from '../../../api/fn/salons/salons-controller-update';
import { salonsControllerUpdateSettings } from '../../../api/fn/salons/salons-controller-update-settings';
import { salonsControllerUpdateSlug } from '../../../api/fn/salons/salons-controller-update-slug';
import { ToastService } from '../../../core/toast/toast.service';
import { OptimisticService } from '../../../core/optimistic/optimistic.service';
import { CachedLoader } from '../../../core/optimistic/cached-loader';
import { isApiError } from '../../../core/errors/api-error.types';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { SalonOverviewService } from '../salon-overview/salon-overview.service';

@Injectable({ providedIn: 'root' })
export class SalonSettingsService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);
  private readonly _optimistic = inject(OptimisticService);
  private readonly _overview = inject(SalonOverviewService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _cache = new Map<string, Salon | null>();
  private readonly _salon = signal<Salon | null>(null);

  private readonly _loader = new CachedLoader({
    signal: this._salon,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (salonId) =>
      salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId }).pipe(
        map((r) => r.body as Salon | null),
      ),
    shouldCache: (v) => v !== null,
  });

  readonly salon = this._salon.asReadonly();
  readonly loading = this._loader.loading;
  readonly error = this._loader.error;

  load(salonId: string): void {
    this._loader.load(salonId);
  }

  /**
   * Update salon name/timezone/hours + settings in one call (forkJoin).
   * Optimistically applies the name change; reconcile from the salon response.
   * Invalidates SalonOverviewService on success so the overview re-fetches.
   */
  update(
    salonId: string,
    salonBody: UpdateSalonDto,
    settingsBody: UpdateSalonSettingsDto,
    onSuccess?: () => void,
  ): void {
    this._optimistic.run({
      signal: this._salon,
      dedupeKey: `SalonSettingsService.update:${salonId}`,
      // Cast needed: UpdateSalonDto has AddressDto while Salon has Address (extra fields).
      // The spread only touches the fields we're actually updating; reconcile corrects the full shape.
      apply: (s) => (s ? ({ ...s, ...salonBody } as unknown as Salon) : s),
      reconcile: (_, { salon }) => salon.body,
      mirror: this._loader.mirrorFn(salonId),
      contextKey: salonId,
      request: () =>
        forkJoin({
          salon: salonsControllerUpdate(this._http, this._apiConfig.rootUrl, {
            salonId,
            body: salonBody,
          }),
          settings: salonsControllerUpdateSettings(this._http, this._apiConfig.rootUrl, {
            salonId,
            body: settingsBody,
          }),
        }),
      errorMessage: 'Could not save settings. Reverted.',
      // Success toast fires optimistically in the component, at save() time —
      // not here, so the user sees it instantly rather than after the round-trip.
      onSuccess: () => {
        this._overview.invalidate(salonId);
        onSuccess?.();
      },
    });
  }

  /**
   * Update slug. Wraps the request to intercept SALON_SLUG_TAKEN locally
   * (inline form error) before the engine's generic revert toast would fire.
   */
  updateSlug(
    salonId: string,
    body: UpdateSlugDto,
    onSuccess?: () => void,
    onSlugTaken?: () => void,
  ): void {
    this._optimistic.run({
      signal: this._salon,
      dedupeKey: `SalonSettingsService.updateSlug:${salonId}`,
      apply: (s) => (s ? { ...s, slug: body.slug } : s),
      reconcile: (_, res) => res.body,
      mirror: this._loader.mirrorFn(salonId),
      contextKey: salonId,
      request: () =>
        salonsControllerUpdateSlug(this._http, this._apiConfig.rootUrl, { salonId, body }).pipe(
          catchError((err: unknown) => {
            const errBody = (err as { error?: unknown })?.error;
            if (isApiError(errBody) && errBody.code === ErrorCodes.SALON_SLUG_TAKEN) {
              onSlugTaken?.();
            }
            return throwError(() => err);
          }),
        ),
      // No errorMessage: the interceptor already toasts ApiErrors; the catchError
      // above handles SALON_SLUG_TAKEN; generic errors fall through to engine default.
      onSuccess: () => {
        this._overview.invalidate(salonId);
        this._toast.success('Slug updated');
        onSuccess?.();
      },
    });
  }

  clear(): void {
    this._cache.clear();
    this._optimistic.reset(this._salon, null);
  }
}
