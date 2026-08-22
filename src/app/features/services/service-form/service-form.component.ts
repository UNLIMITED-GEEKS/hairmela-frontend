import { Component, effect, inject, OnInit, computed, signal, viewChild, ElementRef, Injector, afterNextRender } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ServicesService } from '../services.service';
import { StaffService } from '../../staff/staff.service';
import { SalonStaff } from '../../../api/models/salon-staff';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { CategoriesService } from '../../../core/categories/categories.service';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { TierFreezeDirective } from '../../../shared/directives/tier-freeze.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';

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
  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  protected readonly _location = inject(Location);
  private readonly _fb = inject(FormBuilder);
  private readonly _servicesService = inject(ServicesService);
  private readonly _staffService = inject(StaffService);
  protected readonly salonContext = inject(SalonContextService);
  protected readonly categoriesService = inject(CategoriesService);

  protected readonly loading = this._servicesService.loading;
  protected readonly staffLoading = this._staffService.loading;
  // Guards against a double-tap firing two ngSubmits before navigation away
  // completes — each would create its own optimistic op + a real duplicate
  // server-side create (nothing else in the form/service call chain blocks it).
  protected readonly submitting = signal(false);

  protected readonly isEdit = computed(() => !!this._serviceId);

  // Only ACTIVE staff are offered — the backend's create/update validation
  // requires an assigned staff id to belong to an ACTIVE staff record, so a
  // PENDING/INACTIVE row would just 404 on save if it were checkable here.
  //
  // isAcceptingClients=false staff are excluded too (e.g. an owner who
  // doesn't cut hair), UNLESS they're already checked in this form — hiding
  // them outright would silently unassign them the next time the checklist
  // is touched for any reason and saved (staffIds is only sent when dirty,
  // and a hidden staff member can never show as checked to begin with).
  protected readonly assignableStaff = computed(() => {
    const checked = new Set(this.form.controls.staffIds.value);
    return this._staffService
      .staffList()
      .filter(
        (s) =>
          s.staff.status === 'ACTIVE' &&
          (s.staff.isAcceptingClients || checked.has(s.staff.id)),
      );
  });

  protected readonly form = this._fb.group({
    categoryId: ['', Validators.required],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    duration: [30, [Validators.required, Validators.min(1)]],
    // No default — unlike duration, there's no sensible universal starting
    // price, and a prefilled 0 would silently satisfy `required` even if the
    // owner never touches the field, publishing a service that looks free by
    // accident rather than by choice.
    price: [null as number | null, [Validators.required, Validators.min(0)]],
    description: [''],
    staffIds: this._fb.nonNullable.control<string[]>([]),
    isDynamicPricing: this._fb.nonNullable.control(false),
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  private get _serviceId(): string | null {
    return this._route.snapshot.paramMap.get(RouteParam.SERVICE_ID) ?? null;
  }

  constructor() {
    // Price is only required when dynamic pricing is off — a dynamic-pricing
    // service has no fixed amount to enter, so requiring one would block
    // submit for no reason. min(0) still applies either way (if a price IS
    // entered, it can't be negative).
    this.form.controls.isDynamicPricing.valueChanges.subscribe((isDynamicPricing) => {
      const priceControl = this.form.controls.price;
      priceControl.setValidators(
        isDynamicPricing ? [Validators.min(0)] : [Validators.required, Validators.min(0)],
      );
      priceControl.updateValueAndValidity();
    });

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
            staffIds: service.assignedStaffIds,
            isDynamicPricing: service.isDynamicPricing,
          });
        }
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {
    this.categoriesService.load();
    this._staffService.load(this._salonId);
    // Edit mode: refresh() (a forced fetch bypassing cache), not load(). The
    // staff pre-check below reads service.assignedStaffIds, which the list
    // cache can hold stale — assigning/unassigning a service from a staff
    // member's own page mutates a different cache and never updates this one.
    // Reading fresh at open is why there's no cross-cache sync to maintain:
    // this page reads the source of truth at the point of use instead of
    // trusting a second copy to be kept current. See ServicesService.assignService.
    if (this._serviceId) this._servicesService.refresh(this._salonId);
  }

  protected isStaffChecked(staffId: string): boolean {
    return this.form.controls.staffIds.value.includes(staffId);
  }

  protected toggleStaff(staffId: string, checked: boolean): void {
    const current = this.form.controls.staffIds.value;
    const next = checked ? [...current, staffId] : current.filter((id) => id !== staffId);
    this.form.controls.staffIds.setValue(next);
    this.form.controls.staffIds.markAsDirty();
  }

  protected staffName(s: SalonStaff): string {
    return s.user ? `${s.user.firstName} ${s.user.lastName}` : s.email;
  }

  protected save(): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Deferred: markAllAsTouched only renders the error messages on the next
      // change detection pass, and those messages shift layout — scrolling
      // before they exist lands at the wrong offset.
      afterNextRender(
        () => scrollToFirstInvalidControl(this._formEl()?.nativeElement),
        { injector: this._scrollInjector },
      );
      return;
    }
    this.submitting.set(true);
    const { categoryId, name, duration, price, description, staffIds, isDynamicPricing } =
      this.form.getRawValue();
    const sid = this._serviceId;
    const baseBody = {
      categoryId: categoryId!,
      name: name!,
      duration: duration!,
      price: String(price ?? 0),
      description: description || undefined,
      isDynamicPricing,
    };
    if (sid) {
      // staffIds is only included when the checklist was actually touched —
      // the backend's contract is "omitted = leave assignments untouched",
      // and an edit that never touches the checklist shouldn't silently wipe
      // existing assignments just because the untouched control's value is [].
      const staffIdsChanged = this.form.controls.staffIds.dirty;
      this._servicesService.update(this._salonId, sid, {
        ...baseBody,
        ...(staffIdsChanged ? { staffIds } : {}),
      });
    } else {
      this._servicesService.create(this._salonId, { ...baseBody, staffIds });
    }
    // Navigate immediately — signal is already updated optimistically.
    // If the request fails, OptimisticService reverts the list + toasts the error.
    // replaceUrl swaps out this form's history entry instead of stacking on top
    // of it, so a later browser-back doesn't bounce through the stale form.
    this._router.navigate(RoutePath.salonServices(this._salonId), { replaceUrl: true });
  }
}
