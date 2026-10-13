import {
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
  ElementRef,
  Injector,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { AvailableSlotDto } from '../../../api/models/available-slot-dto';
import { availabilityControllerGetSlots } from '../../../api/fn/schedules/availability-controller-get-slots';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { MiniMonthCalendarComponent } from '../../../shared/components/mini-month-calendar/mini-month-calendar.component';
import { groupByServiceCategory } from '../../../core/utils/group-by-category';
import { StaffService } from '../../../api/models/staff-service';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { monthRange } from '../../../shared/components/slot-picker/iso-date';
import { scrollToNewRow } from '../../../core/utils/scroll-to-new-row';
import { PhoneInputComponent } from '../../../shared/components/phone-input/phone-input.component';

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Extracted from queue-list.component.ts's formerly-inline "Add Queue Modal"
// — same walk-in form/behavior, now with a mode toggle so a barber can
// switch to booking an appointment on a client's behalf without leaving the
// modal. Appointment mode reuses the month-grid date picker + availability
// pattern from book-appointment-dialog.component.ts (the customer-facing
// equivalent) but posts to the staff-add appointment route instead.
@Component({
  selector: 'app-add-client-modal',
  templateUrl: './add-client-modal.component.html',
  imports: [
    ReactiveFormsModule,
    FieldErrorComponent,
    MiniMonthCalendarComponent,
    InlineSpinnerComponent,
    PhoneInputComponent,
  ],
})
export class AddClientModalComponent {
  readonly open = input.required<boolean>();
  readonly salonId = input.required<string>();
  readonly queueId = input.required<string>();
  readonly staffId = input.required<string>();
  readonly initialMode = input<'walk-in' | 'appointment'>('walk-in');
  readonly staffName = input<string>();

  readonly closed = output<void>();

  protected readonly console = inject(QueueConsoleService);
  private readonly _appointmentFieldsEl = viewChild<ElementRef<HTMLElement>>('appointmentFieldsEl');
  private readonly _walkInFieldsEl = viewChild<ElementRef<HTMLElement>>('walkInFieldsEl');
  private readonly _appointmentRows = viewChild<ElementRef<HTMLElement>>('appointmentRows');
  private readonly _scrollInjector = inject(Injector);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _fb = inject(FormBuilder);

  protected readonly staffServices = this.console.staffServices;
  protected readonly staffServiceGroups = computed(() =>
    groupByServiceCategory(this.staffServices(), (s: StaffService) => s.service),
  );

  protected readonly mode = signal<'walk-in' | 'appointment'>('walk-in');

  // ── Walk-in mode — unchanged from the original inline modal ────────────────
  protected readonly addQueueForm = this._fb.group({
    members: this._fb.array([this._buildWalkInRow()]),
  });

  protected get addQueueMembers(): FormArray {
    return this.addQueueForm.get('members') as FormArray;
  }

  // Every row in addQueueMembers/appointmentMembers IS a real party member
  // (unlike join-dialog's kidsArray, which excludes the joining customer as
  // an implicit leader) — so the cap is the salon's full maxPartySize(), no
  // -1 offset. Plain getters, not computed(): FormArray length isn't a
  // signal, so this relies on the same template change-detection the
  // existing `@if (appointmentMembers.length > 1)` check already does.
  //
  // Counts SERVICES, not people: one person booked for three services is three
  // members on the wire, so three against the cap.
  protected get walkInAtMaxPartySize(): boolean {
    return this._atCap(this.addQueueMembers);
  }

  // ── Appointment mode — month-at-a-time availability, refetched only on
  // month change, never cached (live bookable-slot data), matching
  // BookAppointmentDialogComponent's identical pattern ────────────────────
  protected readonly minDate = toIsoDate(new Date());
  protected readonly viewedMonth = signal(startOfMonth(new Date()));
  protected readonly selectedDate = signal<string | null>(null);
  protected readonly monthSlots = signal<AvailableSlotDto[]>([]);
  protected readonly slotsLoading = signal(false);
  protected readonly selectedStartTime = signal<string | null>(null);

  protected readonly badgeFor = computed(() => {
    const daysWithSlots = new Set(
      this.monthSlots()
        .map((s) => s.date)
        .filter((d): d is string => !!d),
    );
    return (iso: string) => (daysWithSlots.has(iso) ? 1 : 0);
  });

  protected readonly selectedDaySlots = computed<AvailableSlotDto[]>(() => {
    const day = this.selectedDate();
    if (!day) return [];
    return this.monthSlots().filter((s) => s.date === day);
  });

  protected readonly appointmentForm = this._fb.group({
    members: this._fb.array([this._buildAppointmentRow()]),
  });

  protected get appointmentMembers(): FormArray {
    return this.appointmentForm.get('members') as FormArray;
  }

  protected get appointmentAtMaxPartySize(): boolean {
    return this._atCap(this.appointmentMembers);
  }

  constructor() {
    // Android back dismisses this modal instead of navigating underneath it.
    registerOverlayWhileOpen(this.open, () => this.close());

    // Reset every time the modal opens — no stale values from a prior open,
    // matching join-dialog's / book-appointment-dialog's own reset effect.
    // Deliberately tracks ONLY this.open() — untracked() wraps the rest
    // because this body reads this.staffServices() (a signal), which would
    // otherwise make the effect a dependent of it too. Without untracked(),
    // any later change to staffServices() (e.g. a console refresh while the
    // modal is open) re-fires this whole reset, silently wiping the form —
    // including switching mode back to 'walk-in' — mid-interaction. Same
    // root cause class as book-appointment-dialog.component.ts's fix: an
    // effect must only react to what it's actually meant to react to, not
    // every signal it happens to read while doing its job.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.addQueueMembers.clear();
        this.addQueueMembers.push(this._buildWalkInRow(this.staffServices()[0]?.serviceId ?? ''));
        this.viewedMonth.set(startOfMonth(new Date()));
        // Auto-select today so Time is visible immediately once appointment
        // mode is entered, not only after a manual day tap.
        this.selectedDate.set(this.minDate);
        this.monthSlots.set([]);
        this.selectedStartTime.set(null);
        this.appointmentMembers.clear();
        this.appointmentMembers.push(
          this._buildAppointmentRow(this.staffServices()[0]?.serviceId ?? ''),
        );

        // Appointments-only salons have no walk-in queue to add to, so open
        // straight into Appointment — the toggle is hidden in that case too.
        //
        // LAST, and via setMode() rather than mode.set(), for two reasons:
        // availability is fetched when appointment mode is ENTERED (setting
        // the signal directly left an empty slot grid with no hidden tab to
        // trigger it), and setMode's fetch must run AFTER the monthSlots
        // reset above — otherwise that reset wipes the result it just asked
        // for.
        this.setMode(
          this.initialMode() === 'appointment' || !this.console.allowsWalkIns()
            ? 'appointment'
            : 'walk-in',
        );
      });
    });
  }

  protected setMode(mode: 'walk-in' | 'appointment'): void {
    this.mode.set(mode);
    if (mode === 'appointment' && this.monthSlots().length === 0 && !this.slotsLoading()) {
      this._fetchMonth();
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  // ── Walk-in mode actions ─────────────────────────────────────────────────

  protected staffAddToQueue(): void {
    if (this.addQueueForm.invalid) {
      this.addQueueForm.markAllAsTouched();
      return;
    }
    const rows = this.addQueueMembers.value as {
      name: string;
      serviceIds: string[];
      phone: string;
    }[];
    const members = this._flatten(rows, false);
    if (members.length === 0) return;
    this.console.staffAddToQueue(
      this.salonId(),
      this.queueId(),
      members,
      () => this.closed.emit(),
      this.staffName(),
    );
  }

  protected addWalkInRow(): void {
    if (this.walkInAtMaxPartySize) return;
    this.addQueueMembers.push(this._buildWalkInRow(this.staffServices()[0]?.serviceId ?? ''));
    this._scrollToNewRow(this._walkInFieldsEl);
  }

  protected removeWalkInRow(i: number): void {
    this.addQueueMembers.removeAt(i);
    if (this.addQueueMembers.length === 0) {
      this.addQueueMembers.push(this._buildWalkInRow(this.staffServices()[0]?.serviceId ?? ''));
    }
  }

  // ── Appointment mode actions ─────────────────────────────────────────────

  protected onMonthChange(month: Date): void {
    this.viewedMonth.set(month);
    // Auto-select the 1st of the newly-visible month so Time stays visible
    // without an extra manual day tap after navigating.
    this.selectedDate.set(toIsoDate(new Date(month.getFullYear(), month.getMonth(), 1)));
    this.selectedStartTime.set(null);
    this._fetchMonth();
  }

  protected onDaySelect(iso: string): void {
    // No toggle-off — a day is always selected once appointment mode is
    // entered, so Time stays visible; re-tapping the same day is a no-op.
    this.selectedDate.set(iso);
    this.selectedStartTime.set(null);
  }

  protected selectSlot(slot: AvailableSlotDto): void {
    this.selectedStartTime.set(slot.startTime);
  }

  private _scrollToNewRow(ref: typeof this._walkInFieldsEl): void {
    // Deferred: the row does not exist in the DOM until Angular has rendered
    // the FormArray change.
    afterNextRender(() => scrollToNewRow(ref()?.nativeElement), { injector: this._scrollInjector });
  }

  protected addAppointmentRow(): void {
    if (this.appointmentAtMaxPartySize) return;
    this.appointmentMembers.push(this._buildAppointmentRow());
    this._scrollToNewRow(this._appointmentRows);
  }

  protected removeAppointmentRow(i: number): void {
    this.appointmentMembers.removeAt(i);
    if (this.appointmentMembers.length === 0) {
      this.appointmentMembers.push(this._buildAppointmentRow());
    }
  }

  protected staffBookAppointment(): void {
    const date = this.selectedDate();
    const startTime = this.selectedStartTime();
    if (!date || !startTime) return;
    if (this.appointmentMembers.invalid) {
      this.appointmentMembers.markAllAsTouched();
      // Scoped to the appointment panel, not the whole modal: the walk-in
      // panel above it holds its own members FormArray, and querying the modal
      // as a whole could scroll to a field in the mode the user is not in.
      afterNextRender(
        () => scrollToFirstInvalidControl(this._appointmentFieldsEl()?.nativeElement),
        { injector: this._scrollInjector },
      );
      return;
    }
    const rows = this.appointmentMembers.value as { name: string; serviceIds: string[] }[];
    const members = this._flatten(rows, true);
    if (members.length === 0) return;

    this.console.staffBookAppointment(
      this.salonId(),
      this.queueId(),
      date,
      startTime,
      members.map((m) => ({ memberName: m.memberName, serviceId: m.serviceId! })),
      () => this.closed.emit(),
      // On failure, stay open on the appointment step (e.g. slot was just
      // taken) so the barber can pick another — refetch to show current slots.
      () => this._fetchMonth(),
      this.staffName(),
    );
  }

  private _fetchMonth(): void {
    const month = this.viewedMonth();
    // Same grid-not-month range the customer picker uses: the calendar pads
    // out to whole weeks, so tapping a trailing day (Feb 3 while viewing
    // January) needs that day's availability already fetched.
    const { from, to } = monthRange(month);
    this.slotsLoading.set(true);
    this.monthSlots.set([]);
    availabilityControllerGetSlots(this._http, this._apiConfig.rootUrl, {
      salonId: this.salonId(),
      staffId: this.staffId(),
      from,
      to,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.monthSlots.set(res.body);
          this.slotsLoading.set(false);
        },
        error: () => this.slotsLoading.set(false),
      });
  }

  // One row is one PERSON; serviceIds holds the services they're booked for.
  // The wire format is flat — one members[] entry per service, all sharing the
  // person's name — so these are expanded at submit (see _flatten).
  private _buildWalkInRow(serviceId = '') {
    return this._fb.group({
      name: ['', Validators.required],
      serviceIds: this._fb.array([this._fb.control(serviceId)]),
      phone: [''],
    });
  }

  private _buildAppointmentRow(serviceId = '') {
    return this._fb.group({
      name: ['', Validators.required],
      serviceIds: this._fb.array([this._fb.control(serviceId, Validators.required)]),
    });
  }

  /**
   * People -> wire members[]: one entry per service, sharing memberName.
   *
   * A person with three services is three members, which is exactly how the
   * backend counts them against maxPartySize (PARTY_TOO_LARGE).
   */
  private _flatten(
    rows: { name: string; serviceIds: string[]; phone?: string }[],
    requireService: boolean,
  ): { memberName: string; serviceId?: string; phone?: string }[] {
    return rows
      .filter((r) => r.name?.trim())
      .flatMap((r) => {
        const name = r.name.trim();
        const phone = r.phone?.trim() ? { phone: r.phone.trim() } : {};
        const ids = (r.serviceIds ?? []).filter((id) => !!id);
        // Walk-ins may be added without a service; appointments may not.
        if (ids.length === 0) return requireService ? [] : [{ memberName: name, ...phone }];
        return ids.map((serviceId) => ({ memberName: name, serviceId, ...phone }));
      });
  }

  /** Total services across everyone — what maxPartySize actually caps. */
  private _countServices(members: FormArray): number {
    return members.controls.reduce((total, row) => {
      const ids = (row.get('serviceIds') as FormArray | null)?.length ?? 0;
      // A person with no service selected still occupies one slot.
      return total + Math.max(ids, 1);
    }, 0);
  }

  protected serviceIdsAt(members: FormArray, i: number): FormArray {
    return members.at(i).get('serviceIds') as FormArray;
  }

  protected addServiceTo(members: FormArray, i: number): void {
    if (this._atCap(members)) return;
    this.serviceIdsAt(members, i).push(this._fb.control(''));
  }

  protected removeServiceFrom(members: FormArray, i: number, serviceIndex: number): void {
    const ids = this.serviceIdsAt(members, i);
    // Never leave a person with zero service rows — the first one stays.
    if (ids.length <= 1) return;
    ids.removeAt(serviceIndex);
  }

  private _atCap(members: FormArray): boolean {
    return this._countServices(members) >= this.console.maxPartySize();
  }
}
