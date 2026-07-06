import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { retry } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { Service } from '../../api/models/service';
import { StaffService as StaffServiceModel } from '../../api/models/staff-service';
import { CreateServiceDto } from '../../api/models/create-service-dto';
import { UpdateServiceDto } from '../../api/models/update-service-dto';
import { SetDefaultServiceDto } from '../../api/models/set-default-service-dto';
import { publicServicesControllerFindBySalon } from '../../api/fn/services/public-services-controller-find-by-salon';
import { servicesControllerCreate } from '../../api/fn/services/services-controller-create';
import { servicesControllerUpdate } from '../../api/fn/services/services-controller-update';
import { servicesControllerDeactivate } from '../../api/fn/services/services-controller-deactivate';
import { staffServicesControllerGetStaffServices } from '../../api/fn/services/staff-services-controller-get-staff-services';
import { staffServicesControllerAssignService } from '../../api/fn/services/staff-services-controller-assign-service';
import { staffServicesControllerRemoveService } from '../../api/fn/services/staff-services-controller-remove-service';
import { staffServicesControllerSetDefaultService } from '../../api/fn/services/staff-services-controller-set-default-service';
import { ToastService } from '../../core/toast/toast.service';
import { OptimisticService, ReadToken } from '../../core/optimistic/optimistic.service';

@Injectable({ providedIn: 'root' })
export class ServicesService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);
  private readonly _optimistic = inject(OptimisticService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _cache = new Map<string, Service[]>();
  private readonly _staffServicesCache = new Map<string, StaffServiceModel[]>();

  private readonly _services = signal<Service[]>([]);
  private readonly _staffServices = signal<StaffServiceModel[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _inflight = new Set<string>();

  readonly services = this._services.asReadonly();
  readonly staffServices = this._staffServices.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(salonId: string): void {
    const token = this._optimistic.beginRead(this._services, salonId);
    const cached = this._cache.get(salonId);
    if (cached) {
      this._optimistic.commitRead(this._services, cached, token, (v) =>
        this._cache.set(salonId, v),
      );
      return;
    }
    if (this._inflight.has(salonId)) return;
    this._fetchServices(salonId, token);
  }

  loadStaffServices(salonId: string, staffId: string): void {
    const ctx = `${salonId}:${staffId}`;
    const token = this._optimistic.beginRead(this._staffServices, ctx);
    const cached = this._staffServicesCache.get(ctx);
    if (cached) {
      this._optimistic.commitRead(this._staffServices, cached, token, (v) =>
        this._staffServicesCache.set(ctx, v),
      );
      return;
    }
    if (this._inflight.has(ctx)) return;
    this._fetchStaffServices(salonId, staffId, token);
  }

  refresh(salonId: string): void {
    const token = this._optimistic.beginRead(this._services, salonId);
    this._cache.delete(salonId);
    this._fetchServices(salonId, token);
  }

  refreshStaffServices(salonId: string, staffId: string): void {
    const ctx = `${salonId}:${staffId}`;
    const token = this._optimistic.beginRead(this._staffServices, ctx);
    this._staffServicesCache.delete(ctx);
    this._fetchStaffServices(salonId, staffId, token);
  }

  create(salonId: string, body: CreateServiceDto, onSuccess?: () => void): void {
    const tempId = `temp_${crypto.randomUUID()}`;
    const optimisticRow = { id: tempId, ...body, isActive: true } as Service;
    // The backend returns the real Service (201 body) — swap the temp row for
    // it so the row's real id is in place before the user can act on it again
    // (delete/edit/assign would otherwise send the fake temp_ id to the server).
    this._optimistic.run({
      signal: this._services,
      // apply is REPLAYED on every recompute (e.g. a concurrent load()'s
      // commitRead landing while this create is still pending) — must be
      // idempotent or a replay duplicates the row. Guard by tempId.
      apply: (list) => (list.some((s) => s.id === tempId) ? list : [...list, optimisticRow]),
      reconcile: (list, res) => list.map((s) => (s.id === tempId ? res.body : s)),
      tempId,
      dedupeKey: `create-service:${salonId}:${body.name}`,
      mirror: (v) => this._cache.set(salonId, v),
      contextKey: salonId,
      request: () =>
        servicesControllerCreate(this._http, this._apiConfig.rootUrl, { salonId, body }),
      errorMessage: 'Could not create service. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
  }

  update(salonId: string, serviceId: string, body: UpdateServiceDto, onSuccess?: () => void): void {
    if (this._optimistic.isPending(serviceId)) return;
    this._optimistic.run({
      signal: this._services,
      apply: (list) => list.map((s) => (s.id === serviceId ? { ...s, ...body } : s)),
      reconcile: (list, res) => list.map((s) => (s.id === serviceId ? res.body : s)),
      mirror: (v) => this._cache.set(salonId, v),
      contextKey: salonId,
      dedupeKey: `update-service:${salonId}:${serviceId}`,
      request: () =>
        servicesControllerUpdate(this._http, this._apiConfig.rootUrl, { salonId, serviceId, body }),
      errorMessage: 'Could not update service. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
  }

  deactivate(salonId: string, serviceId: string, onSuccess?: () => void): void {
    if (this._optimistic.isPending(serviceId)) return;
    this._optimistic.run({
      signal: this._services,
      apply: (list) => list.filter((s) => s.id !== serviceId),
      mirror: (v) => this._cache.set(salonId, v),
      contextKey: salonId,
      dedupeKey: `deactivate-service:${salonId}:${serviceId}`,
      request: () =>
        servicesControllerDeactivate(this._http, this._apiConfig.rootUrl, { salonId, serviceId }),
      errorMessage: 'Could not remove service. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  assignService(salonId: string, staffId: string, serviceId: string): void {
    const ctx = `${salonId}:${staffId}`;
    if (this._optimistic.isPending(serviceId)) return;
    // Placeholder row: only serviceId is real (it's the only field any consumer
    // reads before reconcile below swaps in the server's full authoritative
    // list). Typed honestly as a partial rather than cast to the full model.
    const placeholderRow: Pick<StaffServiceModel, 'serviceId'> = { serviceId };
    this._optimistic.run({
      signal: this._staffServices,
      apply: (list) =>
        list.some((s) => s.serviceId === serviceId)
          ? list
          : [...list, placeholderRow as StaffServiceModel],
      // The backend returns the full authoritative list — replace, don't patch.
      reconcile: (_, res) => res.body,
      mirror: (v) => this._staffServicesCache.set(ctx, v),
      contextKey: ctx,
      dedupeKey: `assign-service:${salonId}:${staffId}:${serviceId}`,
      request: () =>
        staffServicesControllerAssignService(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          serviceId,
        }),
      errorMessage: 'Could not assign service. Reverted.',
    });
  }

  removeService(salonId: string, staffId: string, serviceId: string): void {
    const ctx = `${salonId}:${staffId}`;
    if (this._optimistic.isPending(serviceId)) return;
    this._optimistic.run({
      signal: this._staffServices,
      apply: (list) => list.filter((s) => s.serviceId !== serviceId),
      reconcile: (_, res) => res.body,
      mirror: (v) => this._staffServicesCache.set(ctx, v),
      contextKey: ctx,
      dedupeKey: `remove-service:${salonId}:${staffId}:${serviceId}`,
      request: () =>
        staffServicesControllerRemoveService(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          serviceId,
        }),
      errorMessage: 'Could not remove service. Reverted.',
    });
  }

  setDefaultService(
    salonId: string,
    staffId: string,
    body: SetDefaultServiceDto,
    onRevert?: () => void,
  ): void {
    const ctx = `${salonId}:${staffId}`;
    this._optimistic.run({
      signal: this._staffServices,
      apply: (list) => list.map((s) => ({ ...s, isDefault: s.serviceId === body.serviceId })),
      mirror: (v) => this._staffServicesCache.set(ctx, v),
      contextKey: ctx,
      dedupeKey: `set-default-service:${salonId}:${staffId}:${body.serviceId}`,
      request: () =>
        staffServicesControllerSetDefaultService(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          body,
        }),
      errorMessage: 'Could not set default service. Reverted.',
      onSuccess: () => this._toast.success('Default service updated'),
      onRevert,
    });
  }

  clear(): void {
    this._cache.clear();
    this._staffServicesCache.clear();
    this._services.set([]);
    this._staffServices.set([]);
  }

  private _fetchServices(salonId: string, token: ReadToken): void {
    this._inflight.add(salonId);
    this._loading.set(true);
    this._error.set(false);
    publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, { salonId })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight.delete(salonId);
          this._cache.set(salonId, res.body);
          this._optimistic.commitRead(this._services, res.body, token, (v) =>
            this._cache.set(salonId, v),
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

  private _fetchStaffServices(salonId: string, staffId: string, token: ReadToken): void {
    const ctx = `${salonId}:${staffId}`;
    this._inflight.add(ctx);
    this._loading.set(true);
    this._error.set(false);
    staffServicesControllerGetStaffServices(this._http, this._apiConfig.rootUrl, {
      salonId,
      staffId,
    })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight.delete(ctx);
          this._staffServicesCache.set(ctx, res.body);
          this._optimistic.commitRead(this._staffServices, res.body, token, (v) =>
            this._staffServicesCache.set(ctx, v),
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
