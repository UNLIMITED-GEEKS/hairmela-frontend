import { Component, effect, inject, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ServicesService } from '../services.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { CategoriesService } from '../../../core/categories/categories.service';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { TierFreezeDirective } from '../../../shared/directives/tier-freeze.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-service-form',
  templateUrl: './service-form.component.html',
  imports: [
    ReactiveFormsModule,
    SkeletonComponent,
    FrozenBannerComponent,
    TierFreezeDirective,
    FieldErrorComponent,
    InlineSpinnerComponent,
    PageHeaderComponent,
  ],
})
export class ServiceFormComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _servicesService = inject(ServicesService);
  protected readonly salonContext = inject(SalonContextService);
  protected readonly categoriesService = inject(CategoriesService);

  protected readonly loading = this._servicesService.loading;
  // Guards against a double-tap firing two ngSubmits before navigation away
  // completes — each would create its own optimistic op + a real duplicate
  // server-side create (nothing else in the form/service call chain blocks it).
  protected readonly submitting = signal(false);

  protected readonly isEdit = computed(() => !!this._serviceId);

  protected readonly form = this._fb.group({
    categoryId: ['', Validators.required],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    duration: [30, [Validators.required, Validators.min(1)]],
    price: [0, [Validators.required, Validators.min(0)]],
    description: [''],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  private get _serviceId(): string | null {
    return this._route.snapshot.paramMap.get(RouteParam.SERVICE_ID) ?? null;
  }

  constructor() {
    // Patch form reactively so it works whether the cache was cold or warm.
    // effect() must be created here (a valid injection context), not in
    // ngOnInit() — it still only does anything once _serviceId is set (edit
    // mode) and the matching service has loaded.
    effect(
      () => {
        const sid = this._serviceId;
        if (!sid) return;
        const service = this._servicesService.services().find((s) => s.id === sid);
        if (service && !this.form.dirty) {
          this.form.patchValue({
            categoryId: service.categoryId,
            name: service.name,
            duration: service.duration,
            price: Number(service.price),
            description: service.description ?? '',
          });
        }
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {
    this.categoriesService.load();
    if (this._serviceId) this._servicesService.load(this._salonId);
  }

  protected save(): void {
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    const { categoryId, name, duration, price, description } = this.form.getRawValue();
    const body = {
      categoryId: categoryId!,
      name: name!,
      duration: duration!,
      price: String(price!),
      description: description || undefined,
    };
    const sid = this._serviceId;
    if (sid) {
      this._servicesService.update(this._salonId, sid, body);
    } else {
      this._servicesService.create(this._salonId, body);
    }
    // Navigate immediately — signal is already updated optimistically.
    // If the request fails, OptimisticService reverts the list + toasts the error.
    // replaceUrl swaps out this form's history entry instead of stacking on top
    // of it, so a later browser-back doesn't bounce through the stale form.
    this._router.navigate(RoutePath.salonServices(this._salonId), { replaceUrl: true });
  }
}
