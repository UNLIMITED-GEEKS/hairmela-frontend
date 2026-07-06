import { CacheRegistry } from '../../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, forkJoin, map, throwError } from 'rxjs';
import { retry } from 'rxjs/operators';
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
import { OptimisticService, ReadToken } from '../../../core/optimistic/optimistic.service';
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

  private readonly _cache = new Map<string, Salon>();
  private readonly _salon = signal<Salon | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _inflight = new Set<string>();

  readonly salon = this._salon.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(salonId: string): void {
    const token = this._optimistic.beginRead(this._salon, salonId);
    const cached = this._cache.get(salonId);
    if (cached) {
      this._optimistic.commitRead(this._salon, cached, token, (v) => {
        if (v) this._cache.set(salonId, v);
      });
      return;
    }
    if (this._inflight.has(salonId)) return;
    this._fetch(salonId, token);
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
      mirror: (v) => {
        if (v) this._cache.set(salonId, v);
      },
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
      onSuccess: () => {
        this._overview.invalidate(salonId);
        this._toast.success('Settings saved');
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
      mirror: (v) => {
        if (v) this._cache.set(salonId, v);
      },
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
    this._salon.set(null);
  }

  private _fetch(salonId: string, token: ReadToken): void {
    this._inflight.add(salonId);
    this._loading.set(true);
    this._error.set(false);
    salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight.delete(salonId);
          this._cache.set(salonId, res.body);
          this._optimistic.commitRead(this._salon, res.body, token, (v) => {
            if (v) this._cache.set(salonId, v);
          });
          this._loading.set(false);
        },
        error: () => {
          this._inflight.delete(salonId);
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }
}
