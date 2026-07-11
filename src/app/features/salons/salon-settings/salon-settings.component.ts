import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormArray, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonSettingsService } from './salon-settings.service';
import { SalonOverviewService } from '../salon-overview/salon-overview.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { ToastService } from '../../../core/toast/toast.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { TierFreezeDirective } from '../../../shared/directives/tier-freeze.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RouteParam } from '../../../core/routing/route-paths';

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
  selector: 'app-salon-settings',
  templateUrl: './salon-settings.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent, FrozenBannerComponent, TierFreezeDirective, FieldErrorComponent],
})
export class SalonSettingsComponent implements OnInit {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _settings = inject(SalonSettingsService);
  private readonly _overview = inject(SalonOverviewService);
  protected readonly salonContext = inject(SalonContextService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly days = DAYS;
  protected readonly timezones = TIMEZONES;

  protected readonly form = this._fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', Validators.required],
    about: ['', Validators.maxLength(1000)],
    timezone: ['Africa/Lagos', Validators.required],
    defaultSlotDuration: [30, [Validators.required, Validators.min(5), Validators.max(240)]],
    allowWalkIns: [true],
    maxPartySize: [5, [Validators.required, Validators.min(1), Validators.max(20)]],
    noShowWindow: [10, [Validators.required, Validators.min(1)]],
    operatingHours: this._fb.array(
      DAYS.map((_, i) =>
        this._fb.group({
          enabled: [false],
          dayOfWeek: [i],
          startTime: ['09:00'],
          endTime: ['18:00'],
        }),
      ),
    ),
  });

  protected get hoursArray(): FormArray {
    return this.form.get('operatingHours') as FormArray;
  }

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  constructor() {
    effect(() => {
      const s = this._overview.salon() ?? this._settings.salon();
      if (!s) return;
      const settings = s.settings as Record<string, unknown>;
      this.form.patchValue({
        name: s.name,
        phone: s.phone ?? '',
        about: s.about ?? '',
        timezone: s.timezone,
        defaultSlotDuration: s.defaultSlotDuration,
        allowWalkIns: (settings['allowWalkIns'] as boolean) ?? true,
        maxPartySize: (settings['maxPartySize'] as number) ?? 5,
        noShowWindow: (settings['noShowWindow'] as number) ?? 10,
      });
      const existingHours = s.operatingHours as Array<{
        dayOfWeek: number;
        startTime: string;
        endTime: string;
      }>;
      existingHours.forEach((h) => {
        this.hoursArray
          .at(h.dayOfWeek)
          .patchValue({ enabled: true, startTime: h.startTime, endTime: h.endTime });
      });
      this.loading.set(false);
    });
  }

  ngOnInit(): void {
    const userId = this._currentUser.user()?.id ?? '';
    this._overview.load(this._salonId, userId);
    // Fallback: load directly in case the overview isn't already populated
    if (!this._overview.salon()) {
      this._settings.load(this._salonId);
    }
  }

  protected save(): void {
    if (this.form.invalid) return;

    const v = this.form.value;
    type HourRow = {
      enabled: boolean | null;
      dayOfWeek: number | null;
      startTime: string | null;
      endTime: string | null;
    };
    const enabledHours = ((v.operatingHours ?? []) as HourRow[])
      .filter((h) => !!h.enabled)
      .map((h) => ({
        dayOfWeek: h.dayOfWeek ?? 0,
        startTime: h.startTime ?? '09:00',
        endTime: h.endTime ?? '18:00',
      }));

    this._settings.update(
      this._salonId,
      {
        name: v.name!,
        phone: v.phone!,
        about: v.about || undefined,
        timezone: v.timezone!,
        defaultSlotDuration: v.defaultSlotDuration!,
        operatingHours: enabledHours,
      },
      {
        allowWalkIns: v.allowWalkIns!,
        maxPartySize: v.maxPartySize!,
        noShowWindow: v.noShowWindow!,
      },
    );
    // Optimistic: the UI already reflects the change, so tell the user now
    // rather than waiting on the network round-trip. If the save actually
    // fails, the service's revert path shows its own error toast.
    this._toast.success('Settings saved');
  }
}
