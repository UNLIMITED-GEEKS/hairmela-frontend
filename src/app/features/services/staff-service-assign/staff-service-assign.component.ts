import { Component, inject, OnInit, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Service } from '../../../api/models/service';
import { ServicesService } from '../services.service';
import { StaffServiceAssignService } from './staff-service-assign.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteParam } from '../../../core/routing/route-paths';
import { CurrencyNgnPipe } from '../../../shared/pipes/currency-ngn.pipe';
import { groupByServiceCategory } from '../../../core/utils/group-by-category';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-staff-service-assign',
  templateUrl: './staff-service-assign.component.html',
  imports: [
    SkeletonComponent, RouterLink, PageHeaderComponent, CurrencyNgnPipe],
})
export class StaffServiceAssignComponent implements OnInit {
  // Salon's currency, for price formatting.
  protected readonly salonContext = inject(SalonContextService);
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

  protected readonly serviceGroups = computed(() =>
    groupByServiceCategory(this.allServices(), (s: Service) => s),
  );

  protected readonly assignedServices = computed(() =>
    this.allServices().filter((s) => this.assignedIds().has(s.id)),
  );

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  private get _staffId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) ?? '';
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
    this._assignService.setDefaultServiceId(this._salonId, this._staffId, serviceId);
    this._servicesService.setDefaultService(this._salonId, this._staffId, { serviceId }, () => {
      // Revert the local defaultServiceId if the engine rolled back
      this._assignService.setDefaultServiceId(this._salonId, this._staffId, prev);
    });
  }
}
