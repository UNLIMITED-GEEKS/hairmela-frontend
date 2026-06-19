import { Component, DestroyRef, inject, signal, OnInit, effect } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormArray, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { salonsControllerUpdate } from '../../../api/fn/salons/salons-controller-update';
import { salonsControllerUpdateSettings } from '../../../api/fn/salons/salons-controller-update-settings';
import { ToastService } from '../../../core/toast/toast.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { SalonOverviewService } from '../salon-overview/salon-overview.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONES = [
  'Africa/Lagos', 'Africa/Nairobi', 'Africa/Accra', 'Africa/Johannesburg', 'Africa/Cairo',
  'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Dubai', 'Asia/Kolkata',
];

@Component({
  selector: 'app-salon-settings',
  templateUrl: './salon-settings.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent],
})
export class SalonSettingsComponent implements OnInit {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);
  private readonly _overview = inject(SalonOverviewService);
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly days = DAYS;
  protected readonly timezones = TIMEZONES;

  protected readonly form = this._fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    timezone: ['Africa/Lagos', Validators.required],
    defaultSlotDuration: [30, [Validators.required, Validators.min(5), Validators.max(240)]],
    allowWalkIns: [true],
    maxPartySize: [5, [Validators.required, Validators.min(1), Validators.max(20)]],
    noShowWindow: [10, [Validators.required, Validators.min(1)]],
    operatingHours: this._fb.array(
      DAYS.map((_, i) => this._fb.group({
        enabled: [false],
        dayOfWeek: [i],
        startTime: ['09:00'],
        endTime: ['18:00'],
      }))
    ),
  });

  protected get hoursArray(): FormArray {
    return this.form.get('operatingHours') as FormArray;
  }

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  constructor() {
    effect(() => {
      const s = this._overview.salon();
      if (!s) return;
      const settings = s.settings as Record<string, unknown>;
      this.form.patchValue({
        name: s.name,
        timezone: s.timezone,
        defaultSlotDuration: s.defaultSlotDuration,
        allowWalkIns: (settings['allowWalkIns'] as boolean) ?? true,
        maxPartySize: (settings['maxPartySize'] as number) ?? 5,
        noShowWindow: (settings['noShowWindow'] as number) ?? 10,
      });
      const existingHours = s.operatingHours as Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
      existingHours.forEach((h) => {
        this.hoursArray.at(h.dayOfWeek).patchValue({ enabled: true, startTime: h.startTime, endTime: h.endTime });
      });
      this.loading.set(false);
    });
  }

  ngOnInit(): void {
    const userId = this._currentUser.user()?.id ?? '';
    this._overview.load(this._salonId, userId);
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

    const update$ = salonsControllerUpdate(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      body: { name: v.name!, timezone: v.timezone!, defaultSlotDuration: v.defaultSlotDuration!, operatingHours: enabledHours },
    });

    const settings$ = salonsControllerUpdateSettings(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      body: { allowWalkIns: v.allowWalkIns!, maxPartySize: v.maxPartySize!, noShowWindow: v.noShowWindow! },
    });

    update$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => {
        settings$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
          next: () => {
            this.saving.set(false);
            this._overview.invalidate(this._salonId);
            this._toast.success('Settings saved');
            this._location.back();
          },
          error: () => this.saving.set(false),
        });
      },
      error: () => this.saving.set(false),
    });
  }
}
