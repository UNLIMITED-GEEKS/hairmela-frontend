import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter, startWith } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { BroadcastAutomationResponseDto } from '../../../api/models/broadcast-automation-response-dto';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { uploadMedia } from '../../../core/media/media-upload';
import { RouteParam } from '../../../core/routing/route-paths';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { ToastService } from '../../../core/toast/toast.service';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { PageDescriptionComponent } from '../../../shared/components/page-description/page-description.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { ScreenLayoutComponent } from '../../../shared/components/screen-layout/screen-layout.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';
import { TierFreezeDirective } from '../../../shared/directives/tier-freeze.directive';
import {
  BroadcastChannel,
  CHANNEL_OPTIONS,
  BroadcastSchedule,
  BroadcastScheduleKind,
  MAX_ACTIVE_BROADCAST_AUTOMATIONS,
} from './broadcast-automation.types';
import { BroadcastAutomationsService } from './broadcast-automations.service';
import {
  RUN_STATUS_LABEL,
  WEEKDAY_SHORT,
  describeSchedule,
  formatRunTime,
  schedulesOverlap,
  timezoneLabel,
} from './broadcast-schedule.utils';

type BroadcastAutomation = BroadcastAutomationResponseDto;

const KIND_OPTIONS: { value: BroadcastScheduleKind; label: string }[] = [
  { value: 'ONCE', label: 'Once' },
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'EVERY_N_DAYS', label: 'Every N days' },
];

// Local "yyyy-MM-dd" — toISOString() would give the UTC date, which is
// yesterday/tomorrow for part of every day depending on the owner's offset.
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// FIXME: no component spec yet. Needs coverage for: "Send again" on a sent ONCE
// automation (update must send the new date together with isActive: true), and
// the error mapping in _handleWriteError (409 limit, 400 in past, SALON_FROZEN).
@Component({
  selector: 'app-broadcast-automations',
  templateUrl: './broadcast-automations.component.html',
  imports: [
    ReactiveFormsModule,
    FieldErrorComponent,
    FrozenBannerComponent,
    PageDescriptionComponent,
    PageHeaderComponent,
    ScreenLayoutComponent,
    SkeletonComponent,
    TierFreezeDirective,
    TimePickerComponent,
  ],
})
export class BroadcastAutomationsComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _service = inject(BroadcastAutomationsService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  protected readonly salonContext = inject(SalonContextService);

  private readonly _formCard = viewChild<ElementRef<HTMLElement>>('formCard');

  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly channelOptions = CHANNEL_OPTIONS;
  protected readonly weekdayOptions = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ n, label: WEEKDAY_SHORT[n] }));
  protected readonly maxActive = MAX_ACTIVE_BROADCAST_AUTOMATIONS;
  protected readonly today = todayLocal();
  protected readonly describeSchedule = describeSchedule;
  protected readonly formatRunTime = formatRunTime;
  protected readonly runStatusLabel = RUN_STATUS_LABEL;

  protected readonly automations = signal<BroadcastAutomation[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly audience = signal<number | null>(null);
  // Driven by the API, not hard-coded: anything not listed shows "Coming soon".
  protected readonly availableChannels = signal<BroadcastChannel[]>(['IN_APP']);
  protected readonly channels = signal<BroadcastChannel[]>(['IN_APP']);

  protected readonly showForm = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly weekdays = signal<number[]>([]);
  protected readonly weekdaysTouched = signal(false);
  protected readonly scheduleError = signal<string | null>(null);
  protected readonly mediaUrl = signal<string | null>(null);
  protected readonly uploadingMedia = signal(false);

  protected readonly form = this._fb.group({
    body: ['', [Validators.required, Validators.maxLength(2000)]],
    kind: ['WEEKLY' as BroadcastScheduleKind],
    time: ['09:00', Validators.required],
    date: [''],
    startDate: [''],
    dayOfMonth: [1],
    intervalDays: [2],
  });

  private readonly _formValue = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())));

  protected readonly kind = computed(() => this._formValue()?.kind ?? 'WEEKLY');
  protected readonly bodyLength = computed(() => (this._formValue()?.body ?? '').length);

  protected readonly activeCount = computed(() => this.automations().filter((a) => a.isActive).length);
  protected readonly limitReached = computed(() => this.activeCount() >= MAX_ACTIVE_BROADCAST_AUTOMATIONS);

  // FIXME: before the first automation exists this just says "salon time". Check
  // whether the salon payload already exposes a timezone we can read instead.
  // The API only reports the salon's timezone on an automation, so it's known
  // once at least one exists; until then the label just says "salon time".
  protected readonly salonTimeLabel = computed(() => {
    const tz = this.automations()[0]?.timezone;
    return tz ? `salon time — ${timezoneLabel(tz)}` : 'salon time';
  });

  // Live sentence under the schedule fields, e.g. "Every Monday at 9:00 AM".
  protected readonly preview = computed(() => {
    this._formValue();
    this.weekdays();
    const schedule = this._buildSchedule();
    return schedule ? describeSchedule(schedule) : null;
  });

  // Other active automations this one would share a day with — the later of
  // two on the same day is skipped, since only one automated send goes out/day.
  protected readonly overlapping = computed(() => {
    this._formValue();
    this.weekdays();
    const schedule = this._buildSchedule();
    if (!schedule) return [];
    const editing = this.editingId();
    return this.automations().filter(
      (a) => a.isActive && a.id !== editing && schedulesOverlap(schedule, a.schedule),
    );
  });

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  constructor() {
    this._applyKindValidators('WEEKLY');
    this.form.controls.kind.valueChanges.subscribe((kind) => {
      this._applyKindValidators(kind ?? 'WEEKLY');
      this.scheduleError.set(null);
    });
  }

  ngOnInit(): void {
    this.load();
    this._service.getAudience(this._salonId).subscribe({
      next: (res) => {
        this.audience.set(res.recipientCount);
        this.availableChannels.set(res.availableChannels);
      },
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(false);
    this._service.list(this._salonId).subscribe({
      next: (list) => {
        this.automations.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  protected openCreate(): void {
    this.editingId.set(null);
    this._resetForm();
    this._openForm();
  }

  protected openEdit(automation: BroadcastAutomation): void {
    const s = automation.schedule;
    this.editingId.set(automation.id);
    this._resetForm();
    this.form.patchValue({
      body: automation.body,
      kind: s.kind,
      time: s.time,
      // A one-time send that already went out has a past date — make the owner pick a new one.
      date: s.kind === 'ONCE' && !this.isSentOnce(automation) ? s.date : '',
      startDate: s.kind === 'EVERY_N_DAYS' ? s.startDate : '',
      dayOfMonth: s.kind === 'MONTHLY' ? s.dayOfMonth : 1,
      intervalDays: s.kind === 'EVERY_N_DAYS' ? s.intervalDays : 2,
    });
    this.weekdays.set(s.kind === 'WEEKLY' ? [...s.weekdays] : []);
    this.mediaUrl.set(automation.mediaUrl);
    this.channels.set([...automation.channels]);
    this._openForm();
  }

  protected closeForm(): void {
    this.showForm.set(false);
    this.editingId.set(null);
  }

  // FIXME: toggleChannel and the channel chips in the template are duplicated in
  // salon-chat/broadcast-modal.component — extract one shared component.
  protected toggleChannel(channel: BroadcastChannel): void {
    if (!this.availableChannels().includes(channel)) return;
    const current = this.channels();
    if (current.includes(channel)) {
      if (current.length > 1) this.channels.set(current.filter((c) => c !== channel));
    } else {
      this.channels.set([...current, channel]);
    }
  }

  protected toggleWeekday(day: number): void {
    this.weekdaysTouched.set(true);
    this.weekdays.update((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]));
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploadingMedia.set(true);
    uploadMedia(this._http, this._apiConfig, {
      file,
      entityType: 'SALON',
      entityId: this._salonId,
      type: 'GALLERY',
    }).subscribe({
      next: (media) => {
        this.mediaUrl.set(media.url);
        this.uploadingMedia.set(false);
      },
      error: (err) => {
        this.uploadingMedia.set(false);
        this._toast.error(err?.message || 'Failed to upload image');
      },
    });
    input.value = '';
  }

  protected submit(): void {
    this.weekdaysTouched.set(true);
    if (this.form.invalid || this.uploadingMedia() || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const schedule = this._buildSchedule();
    if (!schedule) return;

    const body = this.form.controls.body.value!.trim();
    const id = this.editingId();
    const mediaUrl = this.mediaUrl();
    const channels = this.channels();
    this.saving.set(true);
    this.scheduleError.set(null);

    // A one-time send that already went out is inactive; saving it with a new
    // date is the only way to send again, and has to reactivate it in the same
    // request (resuming alone is rejected while its date is in the past).
    const editing = id ? this.automations().find((a) => a.id === id) : undefined;
    const reactivate = !!editing && this.isSentOnce(editing);

    const request = id
      ? this._service.update(this._salonId, id, {
          body,
          mediaUrl,
          channels,
          schedule,
          ...(reactivate && { isActive: true }),
        })
      : this._service.create(this._salonId, {
          body,
          channels,
          schedule,
          ...(mediaUrl && { mediaUrl }),
        });

    request.subscribe({
      next: (saved) => {
        this.automations.update((list) =>
          id ? list.map((a) => (a.id === id ? saved : a)) : [saved, ...list],
        );
        this.saving.set(false);
        this.closeForm();
        this._toast.success(id ? 'Automation updated' : 'Automation created');
      },
      error: (err) => this._handleWriteError(err, true),
    });
  }

  protected toggleActive(automation: BroadcastAutomation): void {
    this.busyId.set(automation.id);
    this._service.update(this._salonId, automation.id, { isActive: !automation.isActive }).subscribe({
      next: (saved) => {
        this.automations.update((list) => list.map((a) => (a.id === saved.id ? saved : a)));
        this.busyId.set(null);
        this._toast.success(saved.isActive ? 'Automation resumed' : 'Automation paused');
      },
      error: (err) => {
        this.busyId.set(null);
        this._handleWriteError(err, false);
      },
    });
  }

  protected delete(automation: BroadcastAutomation): void {
    this._confirmDialog
      .open({
        title: 'Delete this automation?',
        message: 'It will stop sending and be removed from the list.',
        confirmLabel: 'Delete',
        danger: true,
      })
      .pipe(filter((ok) => ok))
      .subscribe(() => {
        this.busyId.set(automation.id);
        this._service.delete(this._salonId, automation.id).subscribe({
          next: () => {
            this.automations.update((list) => list.filter((a) => a.id !== automation.id));
            this.busyId.set(null);
            this._toast.success('Automation deleted');
          },
          error: (err) => {
            this.busyId.set(null);
            this._handleWriteError(err, false);
          },
        });
      });
  }

  // A ONCE automation goes inactive after it sends — that's "Sent", not "Paused".
  protected isSentOnce(a: BroadcastAutomation): boolean {
    return a.schedule.kind === 'ONCE' && !!a.lastRunAt && !a.isActive;
  }

  protected statusOf(a: BroadcastAutomation): 'Active' | 'Paused' | 'Sent' {
    if (this.isSentOnce(a)) return 'Sent';
    return a.isActive ? 'Active' : 'Paused';
  }

  private _openForm(): void {
    this.showForm.set(true);
    setTimeout(() => this._formCard()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  private _resetForm(): void {
    this.form.reset({
      body: '',
      kind: 'WEEKLY',
      time: '09:00',
      date: '',
      startDate: '',
      dayOfMonth: 1,
      intervalDays: 2,
    });
    this.weekdays.set([]);
    this.weekdaysTouched.set(false);
    this.scheduleError.set(null);
    this.mediaUrl.set(null);
    this.channels.set(['IN_APP']);
    this._applyKindValidators('WEEKLY');
  }

  // Only the fields the chosen schedule kind actually uses are required.
  private _applyKindValidators(kind: BroadcastScheduleKind): void {
    const { date, startDate, dayOfMonth, intervalDays } = this.form.controls;
    date.setValidators(kind === 'ONCE' ? [Validators.required] : []);
    startDate.setValidators(kind === 'EVERY_N_DAYS' ? [Validators.required] : []);
    dayOfMonth.setValidators(kind === 'MONTHLY' ? [Validators.required, Validators.min(1), Validators.max(31)] : []);
    intervalDays.setValidators(kind === 'EVERY_N_DAYS' ? [Validators.required, Validators.min(2), Validators.max(90)] : []);
    for (const c of [date, startDate, dayOfMonth, intervalDays]) c.updateValueAndValidity({ emitEvent: false });
  }

  // null until the fields for the chosen kind are all valid.
  private _buildSchedule(): BroadcastSchedule | null {
    const v = this.form.getRawValue();
    const time = v.time;
    if (!time) return null;
    switch (v.kind) {
      case 'ONCE':
        return v.date ? { kind: 'ONCE', time, date: v.date } : null;
      case 'DAILY':
        return { kind: 'DAILY', time };
      case 'WEEKLY':
        return this.weekdays().length ? { kind: 'WEEKLY', time, weekdays: [...this.weekdays()].sort((a, b) => a - b) } : null;
      case 'MONTHLY':
        return v.dayOfMonth && v.dayOfMonth >= 1 && v.dayOfMonth <= 31
          ? { kind: 'MONTHLY', time, dayOfMonth: v.dayOfMonth }
          : null;
      case 'EVERY_N_DAYS':
        return v.startDate && v.intervalDays && v.intervalDays >= 2 && v.intervalDays <= 90
          ? { kind: 'EVERY_N_DAYS', time, intervalDays: v.intervalDays, startDate: v.startDate }
          : null;
      default:
        return null;
    }
  }

  private _handleWriteError(err: unknown, fromForm: boolean): void {
    this.saving.set(false);
    const body = (err as { error?: unknown })?.error;
    const code = isApiError(body) ? body.code : null;
    switch (code) {
      case ErrorCodes.BROADCAST_SCHEDULE_IN_PAST:
        // Belongs next to the schedule fields, not in a toast that vanishes.
        if (fromForm) this.scheduleError.set('That date and time has already passed. Pick a later one.');
        else this._toast.error('That schedule has already passed.');
        return;
      case ErrorCodes.BROADCAST_AUTOMATION_LIMIT_REACHED:
        this._toast.error(`You can have at most ${MAX_ACTIVE_BROADCAST_AUTOMATIONS} active automations. Pause one first.`);
        return;
      case ErrorCodes.BROADCAST_CHANNEL_UNAVAILABLE:
        this._toast.error("That channel isn't available yet.");
        return;
      case ErrorCodes.SALON_FROZEN:
        this._toast.error('This salon is frozen — upgrade to make changes.');
        return;
      case ErrorCodes.BROADCAST_AUTOMATION_NOT_FOUND:
        this._toast.error('This automation no longer exists.');
        this.load();
        return;
      default:
        this._toast.error(isApiError(body) ? body.message : 'Something went wrong. Please try again.');
    }
  }
}
