import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { map } from 'rxjs';
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
import { OptimisticService } from '../../core/optimistic/optimistic.service';
import { CachedLoader } from '../../core/optimistic/cached-loader';

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

  // Two independent loaders — salon services and staff services are separate
  // fetch families and can load concurrently without sharing loading/error state.
  private readonly _servicesLoader = new CachedLoader({
    signal: this._services,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (salonId) =>
      publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, { salonId }).pipe(
        map((r) => r.body),
      ),
  });
  private readonly _staffServicesLoader = new CachedLoader({
    signal: this._staffServices,
    optimistic: this._optimistic,
    cache: this._staffServicesCache,
    fetch: (ctx) => {
      const colonIdx = ctx.indexOf(':');
      const salonId = ctx.slice(0, colonIdx);
      const staffId = ctx.slice(colonIdx + 1);
      return staffServicesControllerGetStaffServices(this._http, this._apiConfig.rootUrl, {
        salonId,
        staffId,
      }).pipe(map((r) => r.body));
    },
  });

  readonly services = this._services.asReadonly();
  readonly staffServices = this._staffServices.asReadonly();
  readonly loading = this._servicesLoader.loading;
  readonly staffServicesLoading = this._staffServicesLoader.loading;
  readonly error = this._servicesLoader.error;
  readonly staffServicesError = this._staffServicesLoader.error;

  load(salonId: string): void {
    this._servicesLoader.load(salonId);
  }

  loadStaffServices(salonId: string, staffId: string): void {
    this._staffServicesLoader.load(`${salonId}:${staffId}`);
  }

  refresh(salonId: string): void {
    this._servicesLoader.refresh(salonId);
  }

  refreshStaffServices(salonId: string, staffId: string): void {
    this._staffServicesLoader.refresh(`${salonId}:${staffId}`);
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
      dedupeKey: `ServicesService.create:${salonId}:${body.name}`,
      mirror: this._servicesLoader.mirrorFn(salonId),
      contextKey: salonId,
      request: () =>
        servicesControllerCreate(this._http, this._apiConfig.rootUrl, { salonId, body }),
      errorMessage: 'Could not create service. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
  }

  update(salonId: string, serviceId: string, body: UpdateServiceDto, onSuccess?: () => void): void {
    this._optimistic.run({
      signal: this._services,
      apply: (list) => list.map((s) => (s.id === serviceId ? { ...s, ...body } : s)),
      reconcile: (list, res) => list.map((s) => (s.id === serviceId ? res.body : s)),
      mirror: this._servicesLoader.mirrorFn(salonId),
      contextKey: salonId,
      targetId: serviceId,
      dedupeKey: `ServicesService.update:${salonId}:${serviceId}`,
      request: () =>
        servicesControllerUpdate(this._http, this._apiConfig.rootUrl, { salonId, serviceId, body }),
      errorMessage: 'Could not update service. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
  }

  deactivate(salonId: string, serviceId: string, onSuccess?: () => void): void {
    this._optimistic.run({
      signal: this._services,
      apply: (list) => list.filter((s) => s.id !== serviceId),
      mirror: this._servicesLoader.mirrorFn(salonId),
      contextKey: salonId,
      targetId: serviceId,
      dedupeKey: `ServicesService.deactivate:${salonId}:${serviceId}`,
      request: () =>
        servicesControllerDeactivate(this._http, this._apiConfig.rootUrl, { salonId, serviceId }),
      errorMessage: 'Could not remove service. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  assignService(salonId: string, staffId: string, serviceId: string): void {
    const ctx = `${salonId}:${staffId}`;
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
      mirror: this._staffServicesLoader.mirrorFn(ctx),
      contextKey: ctx,
      targetId: serviceId,
      dedupeKey: `ServicesService.assignService:${salonId}:${staffId}:${serviceId}`,
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
    this._optimistic.run({
      signal: this._staffServices,
      apply: (list) => list.filter((s) => s.serviceId !== serviceId),
      reconcile: (_, res) => res.body,
      mirror: this._staffServicesLoader.mirrorFn(ctx),
      contextKey: ctx,
      targetId: serviceId,
      dedupeKey: `ServicesService.removeService:${salonId}:${staffId}:${serviceId}`,
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
    const accepted = this._optimistic.run({
      signal: this._staffServices,
      apply: (list) => list.map((s) => ({ ...s, isDefault: s.serviceId === body.serviceId })),
      mirror: this._staffServicesLoader.mirrorFn(ctx),
      contextKey: ctx,
      targetId: body.serviceId,
      dedupeKey: `ServicesService.setDefaultService:${salonId}:${staffId}:${body.serviceId}`,
      request: () =>
        staffServicesControllerSetDefaultService(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          body,
        }),
      errorMessage: 'Could not set default service. Reverted.',
      onRevert,
    });
    // Optimistic: the flag already flipped, so tell the user now rather than
    // waiting on the network round-trip.
    if (accepted) this._toast.success('Default service updated');
  }

  clear(): void {
    this._cache.clear();
    this._staffServicesCache.clear();
    this._optimistic.reset(this._services, []);
    this._optimistic.reset(this._staffServices, []);
  }
}
