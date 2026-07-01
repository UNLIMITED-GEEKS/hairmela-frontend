import { Component, OnInit, inject, computed } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Service } from '../../../api/models/service';
import { ServicesService } from '../services.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { filter } from 'rxjs';

@Component({
  selector: 'app-service-list',
  templateUrl: './service-list.component.html',
  imports: [RouterLink, SkeletonComponent, FrozenBannerComponent],
})
export class ServiceListComponent implements OnInit {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _servicesService = inject(ServicesService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly loading = this._servicesService.loading;
  protected readonly services = this._servicesService.services;
  protected readonly actioning = this._servicesService.acting;

  protected readonly canManage = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === 'OWNER' || role === 'ADMIN';
  });

  // Write controls also require an unfrozen salon (frozen = over plan limit,
  // backend rejects writes). Links can't be directive-disabled, so we hide them.
  protected readonly canWrite = computed(() => this.canManage() && !this.salonContext.isFrozen());

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  ngOnInit(): void {
    this._servicesService.load(this._salonId);
  }

  protected deactivate(service: Service): void {
    this._confirmDialog.open({
      title: `Deactivate "${service.name}"?`,
      message: 'This service will be unassigned from all staff and removed from new queues. In-flight queue entries keep their duration.',
      confirmLabel: 'Deactivate',
      danger: true,
    }).pipe(filter((ok) => ok)).subscribe(() => {
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
