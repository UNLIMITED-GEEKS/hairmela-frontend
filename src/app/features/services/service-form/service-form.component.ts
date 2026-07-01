import { Component, DestroyRef, inject, OnInit, signal, computed } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { publicServicesControllerFindBySalon } from '../../../api/fn/services/public-services-controller-find-by-salon';
import { servicesControllerCreate } from '../../../api/fn/services/services-controller-create';
import { servicesControllerUpdate } from '../../../api/fn/services/services-controller-update';
import { ToastService } from '../../../core/toast/toast.service';
import { isApiError } from '../../../core/errors/api-error.types';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { ServicesService } from '../services.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { TierFreezeDirective } from '../../../shared/directives/tier-freeze.directive';

@Component({
  selector: 'app-service-form',
  templateUrl: './service-form.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent, FrozenBannerComponent, TierFreezeDirective],
})
export class ServiceFormComponent implements OnInit {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _fb = inject(FormBuilder);
  private readonly _toast = inject(ToastService);
  private readonly _servicesService = inject(ServicesService);
  protected readonly salonContext = inject(SalonContextService);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  protected readonly isEdit = computed(() => !!this._serviceId);

  protected readonly form = this._fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    duration: [30, [Validators.required, Validators.min(1)]],
    price: ['', Validators.required],
    description: [''],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  private get _serviceId(): string | null {
    return this._route.snapshot.paramMap.get('serviceId') ?? null;
  }

  ngOnInit(): void {
    const sid = this._serviceId;
    if (!sid) return;

    this.loading.set(true);
    publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: (res) => {
        const service = res.body.find((s) => s.id === sid);
        if (service) {
          this.form.patchValue({
            name: service.name,
            duration: service.duration,
            price: service.price,
            description: service.description ?? '',
          });
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);

    const { name, duration, price, description } = this.form.getRawValue();

    const sid = this._serviceId;
    const call$ = sid
      ? servicesControllerUpdate(this._http, this._apiConfig.rootUrl, {
          salonId: this._salonId,
          serviceId: sid,
          body: { name: name!, duration: duration!, price: price!, description: description || undefined },
        })
      : servicesControllerCreate(this._http, this._apiConfig.rootUrl, {
          salonId: this._salonId,
          body: { name: name!, duration: duration!, price: price!, description: description || undefined },
        });

    call$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this._toast.success(sid ? 'Service updated' : 'Service created');
        this._servicesService.clear();
        this._servicesService.load(this._salonId);
        this._location.back();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        if (isApiError(err) && err.code === ErrorCodes.SERVICE_NAME_TAKEN) {
          this.form.get('name')?.setErrors({ nameTaken: true });
        }
      },
    });
  }
}
