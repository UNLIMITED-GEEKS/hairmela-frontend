import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormBuilder, FormArray, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { salonsControllerFindOne } from '../../../api/fn/salons/salons-controller-find-one';
import { salonsControllerUpdate } from '../../../api/fn/salons/salons-controller-update';
import { salonsControllerUpdateSettings } from '../../../api/fn/salons/salons-controller-update-settings';
import { ToastService } from '../../../core/toast/toast.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONES = [
  'Africa/Lagos', 'Africa/Nairobi', 'Africa/Accra', 'Africa/Johannesburg', 'Africa/Cairo',
  'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Dubai', 'Asia/Kolkata',
];

@Component({
  selector: 'app-salon-settings',
  templateUrl: './salon-settings.component.html',
  imports: [ReactiveFormsModule, RouterLink, SkeletonComponent],
})
export class SalonSettingsComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);

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

  ngOnInit(): void {
    salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId: this._salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        const s = res.body;
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
          const ctrl = this.hoursArray.at(h.dayOfWeek);
          ctrl.patchValue({ enabled: true, startTime: h.startTime, endTime: h.endTime });
        });

        this.loading.set(false);
      },
      error: () => {
        this._toast.error('Salon not found');
        this._router.navigate(['/dashboard']);
      },
    });
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
            this._toast.success('Settings saved');
            this._router.navigate(['..'], { relativeTo: this._route });
          },
          error: () => this.saving.set(false),
        });
      },
      error: () => this.saving.set(false),
    });
  }
}
