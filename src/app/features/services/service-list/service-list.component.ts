import { Component, DestroyRef, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { servicesControllerDeactivate } from '../../../api/fn/services/services-controller-deactivate';
import { Service } from '../../../api/models/service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../core/toast/toast.service';

@Component({
  selector: 'app-service-list',
  templateUrl: './service-list.component.html',
  imports: [RouterLink],
})
export class ServiceListComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly loading = signal(true);
  protected readonly services = signal<Service[]>([]);
  protected readonly actioning = signal<string | null>(null);

  protected readonly canManage = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === 'OWNER' || role === 'ADMIN';
  });

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  ngOnInit(): void {
    this._load();
  }

  private _load(): void {
    this._http.get<Service[]>(
      `${this._apiConfig.rootUrl}/v1/salons/${this._salonId}/services`,
    ).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: (services) => {
        this.services.set(services);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected deactivate(service: Service): void {
    this._confirmDialog.open({
      title: `Deactivate "${service.name}"?`,
      message: 'This service will be unassigned from all staff and removed from new queues. In-flight queue entries keep their duration.',
      confirmLabel: 'Deactivate',
      danger: true,
    }).pipe(
      filter((ok) => ok),
      switchMap(() => {
        this.actioning.set(service.id);
        return servicesControllerDeactivate(this._http, this._apiConfig.rootUrl, {
          salonId: this._salonId,
          serviceId: service.id,
        });
      }),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this.actioning.set(null);
        this.services.update((list) => list.filter((s) => s.id !== service.id));
        this._toast.success('Service deactivated');
      },
      error: () => this.actioning.set(null),
    });
  }

  protected formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
}
