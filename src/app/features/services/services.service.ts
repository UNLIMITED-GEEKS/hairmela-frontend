import { Injectable, inject, signal } from '@angular/core';
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

@Injectable({ providedIn: 'root' })
export class ServicesService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);

  private readonly _cache = new Map<string, Service[]>();
  private readonly _staffServicesCache = new Map<string, StaffServiceModel[]>();

  private readonly _services = signal<Service[]>([]);
  private readonly _staffServices = signal<StaffServiceModel[]>([]);
  private readonly _loading = signal(false);
  private readonly _acting = signal(false);

  readonly services = this._services.asReadonly();
  readonly staffServices = this._staffServices.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly acting = this._acting.asReadonly();

  load(salonId: string): void {
    const cached = this._cache.get(salonId);
    if (cached) { this._services.set(cached); return; }
    this._fetchServices(salonId);
  }

  loadStaffServices(salonId: string, staffId: string): void {
    const key = `${salonId}:${staffId}`;
    const cached = this._staffServicesCache.get(key);
    if (cached) { this._staffServices.set(cached); return; }
    this._fetchStaffServices(salonId, staffId);
  }

  refresh(salonId: string): void {
    this._cache.delete(salonId);
    this._fetchServices(salonId);
  }

  refreshStaffServices(salonId: string, staffId: string): void {
    this._staffServicesCache.delete(`${salonId}:${staffId}`);
    this._fetchStaffServices(salonId, staffId);
  }

  create(salonId: string, body: CreateServiceDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    servicesControllerCreate(this._http, this._apiConfig.rootUrl, { salonId, body }).subscribe({
      next: () => { this._acting.set(false); this.refresh(salonId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  update(salonId: string, serviceId: string, body: UpdateServiceDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    servicesControllerUpdate(this._http, this._apiConfig.rootUrl, { salonId, serviceId, body }).subscribe({
      next: () => { this._acting.set(false); this.refresh(salonId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  deactivate(salonId: string, serviceId: string, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    servicesControllerDeactivate(this._http, this._apiConfig.rootUrl, { salonId, serviceId }).subscribe({
      next: () => { this._acting.set(false); this.refresh(salonId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  assignService(salonId: string, staffId: string, serviceId: string): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffServicesControllerAssignService(this._http, this._apiConfig.rootUrl, { salonId, staffId, serviceId }).subscribe({
      next: () => { this._acting.set(false); this.refreshStaffServices(salonId, staffId); },
      error: () => this._acting.set(false),
    });
  }

  removeService(salonId: string, staffId: string, serviceId: string): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffServicesControllerRemoveService(this._http, this._apiConfig.rootUrl, { salonId, staffId, serviceId }).subscribe({
      next: () => { this._acting.set(false); this.refreshStaffServices(salonId, staffId); },
      error: () => this._acting.set(false),
    });
  }

  setDefaultService(salonId: string, staffId: string, body: SetDefaultServiceDto): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffServicesControllerSetDefaultService(this._http, this._apiConfig.rootUrl, { salonId, staffId, body }).subscribe({
      next: () => { this._acting.set(false); this._toast.success('Default service updated'); },
      error: () => this._acting.set(false),
    });
  }

  clear(): void {
    this._cache.clear();
    this._staffServicesCache.clear();
    this._services.set([]);
    this._staffServices.set([]);
  }

  private _fetchServices(salonId: string): void {
    this._loading.set(true);
    publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, { salonId }).subscribe({
      next: (res) => { this._cache.set(salonId, res.body); this._services.set(res.body); this._loading.set(false); },
      error: () => this._loading.set(false),
    });
  }

  private _fetchStaffServices(salonId: string, staffId: string): void {
    this._loading.set(true);
    staffServicesControllerGetStaffServices(this._http, this._apiConfig.rootUrl, { salonId, staffId }).subscribe({
      next: (res) => {
        const key = `${salonId}:${staffId}`;
        this._staffServicesCache.set(key, res.body);
        this._staffServices.set(res.body);
        this._loading.set(false);
      },
      error: () => this._loading.set(false),
    });
  }
}
