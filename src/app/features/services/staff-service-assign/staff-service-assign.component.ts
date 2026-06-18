import { Component, DestroyRef, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, map } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { staffServicesControllerGetStaffServices } from '../../../api/fn/services/staff-services-controller-get-staff-services';
import { staffServicesControllerAssignService } from '../../../api/fn/services/staff-services-controller-assign-service';
import { staffServicesControllerRemoveService } from '../../../api/fn/services/staff-services-controller-remove-service';
import { staffServicesControllerSetDefaultService } from '../../../api/fn/services/staff-services-controller-set-default-service';
import { staffControllerFindAll } from '../../../api/fn/staff/staff-controller-find-all';
import { Service } from '../../../api/models/service';
import { ServicesService } from '../services.service';
import { ToastService } from '../../../core/toast/toast.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-staff-service-assign',
  templateUrl: './staff-service-assign.component.html',
  imports: [RouterLink, SkeletonComponent],
})
export class StaffServiceAssignComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _servicesService = inject(ServicesService);
  private readonly _toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly assignedIds = signal<Set<string>>(new Set());
  protected readonly defaultServiceId = signal<string | null>(null);
  protected readonly toggling = signal<string | null>(null);
  protected readonly settingDefault = signal(false);

  protected readonly allServices = computed(() =>
    this._servicesService.services().filter((s) => s.isActive),
  );

  protected readonly assignedServices = computed(() =>
    this.allServices().filter((s) => this.assignedIds().has(s.id)),
  );

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  private get _staffId(): string {
    return this._route.snapshot.paramMap.get('staffId') ?? '';
  }

  ngOnInit(): void {
    this._servicesService.load(this._salonId);

    forkJoin({
      assigned: staffServicesControllerGetStaffServices(this._http, this._apiConfig.rootUrl, {
        salonId: this._salonId, staffId: this._staffId,
      }).pipe(map((r) => r.body)),
      staffList: staffControllerFindAll(this._http, this._apiConfig.rootUrl, {
        salonId: this._salonId,
      }).pipe(map((r) => r.body)),
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: ({ assigned, staffList }) => {
        this.assignedIds.set(new Set((assigned ?? []).map((ss) => ss.serviceId)));
        const staffRecord = staffList.find((s) => s.staff.id === this._staffId);
        this.defaultServiceId.set(staffRecord?.staff.defaultServiceId ?? null);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected toggle(service: Service): void {
    if (this.toggling()) return;
    const isAssigned = this.assignedIds().has(service.id);
    this.toggling.set(service.id);

    const call$ = isAssigned
      ? staffServicesControllerRemoveService(this._http, this._apiConfig.rootUrl, {
          salonId: this._salonId, staffId: this._staffId, serviceId: service.id,
        })
      : staffServicesControllerAssignService(this._http, this._apiConfig.rootUrl, {
          salonId: this._salonId, staffId: this._staffId, serviceId: service.id,
        });

    call$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => {
        this.assignedIds.update((set) => {
          const next = new Set(set);
          isAssigned ? next.delete(service.id) : next.add(service.id);
          return next;
        });
        if (isAssigned && this.defaultServiceId() === service.id) this.defaultServiceId.set(null);
        this.toggling.set(null);
        this._servicesService.refreshStaffServices(this._salonId, this._staffId);
      },
      error: () => this.toggling.set(null),
    });
  }

  protected setDefault(serviceId: string): void {
    if (this.settingDefault()) return;
    this.settingDefault.set(true);
    staffServicesControllerSetDefaultService(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId, staffId: this._staffId, body: { serviceId },
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => {
        this.defaultServiceId.set(serviceId);
        this.settingDefault.set(false);
        this._servicesService.refreshStaffServices(this._salonId, this._staffId);
        this._toast.success('Default service updated');
      },
      error: () => this.settingDefault.set(false),
    });
  }
}
