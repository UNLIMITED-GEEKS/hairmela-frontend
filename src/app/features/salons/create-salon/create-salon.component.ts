import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormArray, ReactiveFormsModule, Validators } from '@angular/forms';
import { DashboardService } from '../../dashboard/dashboard.service';
import { SalonService } from '../salon.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { CategoriesService } from '../../../core/categories/categories.service';
import { RoutePath } from '../../../core/routing/route-paths';

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
  imports: [ReactiveFormsModule, FieldErrorComponent, InlineSpinnerComponent],
})
export class CreateSalonComponent implements OnInit {
  private readonly _location = inject(Location);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _dashboardService = inject(DashboardService);
  private readonly _salonService = inject(SalonService);
  protected readonly categoriesService = inject(CategoriesService);

  protected readonly saving = signal(false);
  protected readonly days = DAYS;
  protected readonly timezones = TIMEZONES;

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
    operatingHours: this._fb.array(
      DAYS.map((_, i) => this._fb.group({
        enabled: [i >= 1 && i <= 5],
        dayOfWeek: [i],
        startTime: ['09:00'],
        endTime: ['18:00'],
      }))
    ),
    service: this._fb.group({
      categoryId: ['', Validators.required],
      name: ['', [Validators.required, Validators.minLength(2)]],
      duration: [30, [Validators.required, Validators.min(5), Validators.max(480)]],
      price: [0, [Validators.required, Validators.min(0)]],
      description: [''],
    }),
  });

  ngOnInit(): void {
    this.categoriesService.load();
  }

  protected get hoursArray(): FormArray {
    return this.form.get('operatingHours') as FormArray;
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);

    const v = this.form.value;
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
        service: {
          categoryId: v.service!.categoryId!,
          name: v.service!.name!,
          duration: v.service!.duration!,
          price: String(v.service!.price ?? '0'),
          description: v.service!.description ?? undefined,
        },
      },
      this._destroyRef,
      (salon) => {
        this.saving.set(false);
        this._dashboardService.clear();
        this._dashboardService.load();
        this._router.navigate(RoutePath.salon(salon.id));
      },
      () => this.saving.set(false),
    );
  }

  protected cancel(): void {
    this._location.back();
  }
}
