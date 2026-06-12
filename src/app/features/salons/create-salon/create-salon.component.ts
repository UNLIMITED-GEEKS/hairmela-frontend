import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormArray, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { userSalonsControllerCreate } from '../../../api/fn/salons/user-salons-controller-create';
import { ToastService } from '../../../core/toast/toast.service';
import { isApiError } from '../../../core/errors/api-error.types';
import { ErrorCodes } from '../../../core/errors/error-codes';

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
  imports: [ReactiveFormsModule],
})
export class CreateSalonComponent {
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);

  protected readonly saving = signal(false);
  protected readonly days = DAYS;
  protected readonly timezones = TIMEZONES;

  protected readonly form = this._fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
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
  });

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

    userSalonsControllerCreate(this._http, this._apiConfig.rootUrl, {
      body: {
        name: v.name!,
        address: {
          country: v.address!.country!,
          state: v.address!.state!,
          city: v.address!.city!,
          street: v.address!.street!,
        },
        timezone: v.timezone!,
        defaultSlotDuration: v.defaultSlotDuration!,
        operatingHours: enabledHours,
      },
    }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this.saving.set(false);
        this._toast.success('Salon created');
        this._router.navigate(['/dashboard']);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        if (isApiError(err) && err.code === ErrorCodes.SALON_LIMIT_REACHED) {
          this._toast.error('Plan limit reached — upgrade to create more salons');
        }
      },
    });
  }

  protected cancel(): void {
    this._router.navigate(['/dashboard']);
  }
}
