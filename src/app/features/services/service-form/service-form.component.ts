import { Component, DestroyRef, effect, inject, OnInit, signal, computed } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
  private readonly _fb = inject(FormBuilder);
  private readonly _toast = inject(ToastService);
  private readonly _servicesService = inject(ServicesService);
  protected readonly salonContext = inject(SalonContextService);

  protected readonly loading = this._servicesService.loading;
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
    this._servicesService.load(this._salonId);
    // Patch form reactively so it works whether the cache was cold or warm
    effect(
      () => {
        const service = this._servicesService.services().find((s) => s.id === sid);
        if (service && !this.form.dirty) {
          this.form.patchValue({
            name: service.name,
            duration: service.duration,
            price: service.price,
            description: service.description ?? '',
          });
        }
      },
      { allowSignalWrites: true },
    );
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const { name, duration, price, description } = this.form.getRawValue();
    const body = {
      name: name!,
      duration: duration!,
      price: price!,
      description: description || undefined,
    };
    const sid = this._serviceId;
    const onSuccess = () => {
      this.saving.set(false);
      this._toast.success(sid ? 'Service updated' : 'Service created');
      this._location.back();
    };
    const onError = (err: unknown) => {
      this.saving.set(false);
      if (isApiError(err) && (err as { code: string }).code === ErrorCodes.SERVICE_NAME_TAKEN) {
        this.form.get('name')?.setErrors({ nameTaken: true });
      }
    };
    if (sid) {
      this._servicesService.update(this._salonId, sid, body, onSuccess);
    } else {
      this._servicesService.create(this._salonId, body, onSuccess);
    }
  }
}
