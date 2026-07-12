import { Component, OnInit, inject, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Service } from '../../../api/models/service';
import { ServicesService } from '../services.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { AnimatedListComponent } from '../../../shared/components/animated-list/animated-list.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { ScreenLayoutComponent } from '../../../shared/components/screen-layout/screen-layout.component';
import { RouteParam, RouteSegment } from '../../../core/routing/route-paths';
import { filter } from 'rxjs';

@Component({
  selector: 'app-service-list',
  templateUrl: './service-list.component.html',
  imports: [
    RouterLink,
    SkeletonComponent,
    FrozenBannerComponent,
    AnimatedListComponent,
    PageHeaderComponent,
    ScreenLayoutComponent,
  ],
})
export class ServiceListComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _servicesService = inject(ServicesService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly loading = this._servicesService.loading;
  protected readonly error = this._servicesService.error;
  protected readonly services = this._servicesService.services;

  protected readonly canManage = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === SalonRole.OWNER || role === SalonRole.ADMIN;
  });

  // Write controls also require an unfrozen salon (frozen = over plan limit,
  // backend rejects writes). Links can't be directive-disabled, so we hide them.
  protected readonly canWrite = computed(() => this.canManage() && !this.salonContext.isFrozen());

  protected readonly newServiceLink = [RouteSegment.NEW];

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected editServiceLink(serviceId: string): string[] {
    return [serviceId, RouteSegment.EDIT];
  }

  ngOnInit(): void {
    this._servicesService.load(this._salonId);
  }

  protected retry(): void {
    this._servicesService.refresh(this._salonId);
  }

  protected deactivate(service: Service): void {
    this._confirmDialog
      .open({
        title: `Delete "${service.name}"?`,
        message:
          'This service will be unassigned from all staff and removed from new queues. In-flight queue entries keep their duration.',
        confirmLabel: 'Delete',
        danger: true,
      })
      .pipe(filter((ok) => ok))
      .subscribe(() => {
        this._servicesService.deactivate(this._salonId, service.id);
      });
  }

  protected formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
}
