import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AbstractControlOptions,
  FormBuilder,
  FormArray,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { MembershipStore } from '../../../core/salon-context/membership.store';
import { SalonService } from '../salon.service';
import { BranchPickerService } from '../../visit/branch-picker/branch-picker.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';
import { CategoriesService } from '../../../core/categories/categories.service';
import { RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';
import { endAfterStart } from '../../../core/utils/time-range.validator';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TIMEZONES = [
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Accra',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
];

@Component({
  selector: 'app-create-salon',
  templateUrl: './create-salon.component.html',
  imports: [ReactiveFormsModule, FieldErrorComponent, InlineSpinnerComponent, TimePickerComponent],
})
export class CreateSalonComponent implements OnInit {
  private readonly _location = inject(Location);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _dashboardService = inject(SalonsStore);
  private readonly _salonService = inject(SalonService);
  private readonly _branchPicker = inject(BranchPickerService);
  private readonly _membershipStore = inject(MembershipStore);
  protected readonly categoriesService = inject(CategoriesService);

  protected readonly saving = signal(false);
  protected readonly days = DAYS;
  protected readonly timezones = TIMEZONES;

  // Set when this form was opened via Salon Overview's "Create a new branch"
  // (?parentSalonId=...&parentSalonName=...) — read once in ngOnInit via
  // snapshot, not reactively: this route has no sibling config that could
  // cause Angular to reuse this component instance across a param change the
  // way SalonShellComponent's slug does, so a one-time read is safe here.
  protected readonly parentSalonId = signal<string | null>(null);

  protected readonly form = this._fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', Validators.required],
    about: ['', Validators.maxLength(1000)],
    address: this._fb.group({
      country: ['', Validators.required],
      state: ['', Validators.required],
      city: ['', Validators.required],
      street: ['', Validators.required],
    }),
    timezone: ['Africa/Lagos', Validators.required],
    defaultSlotDuration: [30, [Validators.required, Validators.min(5), Validators.max(240)]],
    showPrice: [false],
    operatingHours: this._fb.array(
      DAYS.map((_, i) => this._fb.group({
        enabled: [i >= 1 && i <= 5],
        dayOfWeek: [i],
        startTime: ['09:00'],
        endTime: ['18:00'],
      }, { validators: endAfterStart } as AbstractControlOptions))
    ),
    service: this._fb.group({
      categoryId: ['', Validators.required],
      name: ['', [Validators.required, Validators.minLength(2)]],
      duration: [30, [Validators.required, Validators.min(5), Validators.max(480)]],
      // No default — unlike duration, there's no sensible universal starting
      // price, and a prefilled 0 would silently satisfy `required` even if
      // the owner never touches the field, publishing a service that looks
      // free by accident rather than by choice.
      price: [null as number | null, [Validators.required, Validators.min(0)]],
      description: [''],
    }),
  });

  ngOnInit(): void {
    this.categoriesService.load();
    const parentId = this._route.snapshot.queryParamMap.get(RouteQueryParam.PARENT_SALON_ID);
    const parentName = this._route.snapshot.queryParamMap.get(RouteQueryParam.PARENT_SALON_NAME);
    if (parentId) {
      this.parentSalonId.set(parentId);
      if (parentName) {
        this.form.patchValue({ name: parentName });
        // Locked, not just visually — the backend forces a branch's name to
        // match its root anyway, so this only prevents a confusing "type a
        // name, then have it silently overridden" moment. getRawValue() (not
        // .value) is used in save() specifically so a disabled control's
        // value still makes it into the submitted DTO.
        this.form.get('name')?.disable();
      }
    }
  }

  protected get hoursArray(): FormArray {
    return this.form.get('operatingHours') as FormArray;
  }

  protected save(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);

    // getRawValue(), not .value — .value excludes disabled controls (the
    // locked `name` field in branch-creation mode), which would otherwise
    // submit as undefined.
    const v = this.form.getRawValue();
    type HourRow = { enabled: boolean | null; dayOfWeek: number | null; startTime: string | null; endTime: string | null };
    const enabledHours = ((v.operatingHours ?? []) as HourRow[])
      .filter((h) => !!h.enabled)
      .map((h) => ({
        dayOfWeek: h.dayOfWeek ?? 0,
        startTime: h.startTime ?? '09:00',
        endTime: h.endTime ?? '18:00',
      }));

    this._salonService.create(
      {
        name: v.name!,
        phone: v.phone!,
        about: v.about || undefined,
        address: {
          country: v.address!.country!,
          state: v.address!.state!,
          city: v.address!.city!,
          street: v.address!.street!,
        },
        timezone: v.timezone!,
        defaultSlotDuration: v.defaultSlotDuration!,
        operatingHours: enabledHours,
        settings: { showPrice: v.showPrice! },
        service: {
          categoryId: v.service!.categoryId!,
          name: v.service!.name!,
          duration: v.service!.duration!,
          price: String(v.service!.price ?? '0'),
          description: v.service!.description ?? undefined,
        },
      },
      this._destroyRef,
      ({ salon, membership }) => {
        this._dashboardService.clear();
        this._dashboardService.load();
        // The create response already includes the creator's membership —
        // seed the cache directly instead of re-fetching what we already
        // have, so salonRoleGuard resolves from cache with zero latency.
        this._membershipStore.setFromDto(membership);

        const parentId = this.parentSalonId();
        if (parentId) {
          // One flow: create, then immediately attach as a branch — the user
          // never sees an intermediate standalone-salon state. Navigate
          // either way on settle: the salon was genuinely created and is
          // usable even if the attach call itself fails (its own error toast
          // already told them that part failed; stranding them here would be
          // worse than landing them somewhere they can retry from Settings).
          this._salonService.attachBranch(
            salon.id,
            parentId,
            this._destroyRef,
            (attached) => {
              // The root's picker page is cached by slug and just gained a
              // branch — drop it so the next visit shows this new location.
              const parentSlug = attached.parent?.slug;
              if (parentSlug) this._branchPicker.invalidate(parentSlug);
              this.saving.set(false);
              this._router.navigate(RoutePath.salon(salon.id));
            },
            () => {
              this.saving.set(false);
              this._router.navigate(RoutePath.salon(salon.id));
            },
          );
          return;
        }

        this.saving.set(false);
        this._router.navigate(RoutePath.salon(salon.id));
      },
      () => this.saving.set(false),
    );
  }

  protected cancel(): void {
    this._location.back();
  }
}
