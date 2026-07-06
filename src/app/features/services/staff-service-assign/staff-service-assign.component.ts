import { Component, inject, OnInit, computed } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Service } from '../../../api/models/service';
import { ServicesService } from '../services.service';
import { StaffServiceAssignService } from './staff-service-assign.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-staff-service-assign',
  templateUrl: './staff-service-assign.component.html',
  imports: [RouterLink, SkeletonComponent],
})
export class StaffServiceAssignComponent implements OnInit {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _servicesService = inject(ServicesService);
  private readonly _assignService = inject(StaffServiceAssignService);

  protected readonly loading = this._assignService.loading;
  protected readonly error = this._assignService.error;

  // Derived from the engine-managed staffServices signal — always in sync, never diverges
  protected readonly assignedIds = computed(
    () => new Set(this._servicesService.staffServices().map((s) => s.serviceId)),
  );
  // defaultServiceId comes from the staff record; StaffServiceAssignService loads it
  protected readonly defaultServiceId = this._assignService.defaultServiceId;

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
    this._servicesService.loadStaffServices(this._salonId, this._staffId);
    this._assignService.load(this._salonId, this._staffId);
  }

  protected retry(): void {
    this._assignService.load(this._salonId, this._staffId);
  }

  protected toggle(service: Service): void {
    const isAssigned = this.assignedIds().has(service.id);
    if (isAssigned) {
      this._servicesService.removeService(this._salonId, this._staffId, service.id);
    } else {
      this._servicesService.assignService(this._salonId, this._staffId, service.id);
    }
  }

  protected setDefault(serviceId: string): void {
    const prev = this.defaultServiceId();
    this._assignService.setDefaultServiceId(serviceId);
    this._servicesService.setDefaultService(this._salonId, this._staffId, { serviceId }, () => {
      // Revert the local defaultServiceId if the engine rolled back
      this._assignService.setDefaultServiceId(prev);
    });
  }
}
