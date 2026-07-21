import { Component, DestroyRef, inject, input, output, signal, computed, effect, untracked } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { AvailableSlotDto } from '../../../api/models/available-slot-dto';
import { availabilityControllerGetSlots } from '../../../api/fn/schedules/availability-controller-get-slots';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { MiniMonthCalendarComponent } from '../../../shared/components/mini-month-calendar/mini-month-calendar.component';

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
  imports: [ReactiveFormsModule, FieldErrorComponent, MiniMonthCalendarComponent],
})
export class AddClientModalComponent {
  readonly open = input.required<boolean>();
  readonly salonId = input.required<string>();
  readonly queueId = input.required<string>();
  readonly staffId = input.required<string>();

  readonly closed = output<void>();

  protected readonly console = inject(QueueConsoleService);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _fb = inject(FormBuilder);

  protected readonly staffServices = this.console.staffServices;

  protected readonly mode = signal<'walk-in' | 'appointment'>('walk-in');

  // ── Walk-in mode — unchanged from the original inline modal ────────────────
  protected readonly addQueueForm = this._fb.group({
    members: this._fb.array([this._buildWalkInRow()]),
  });

  protected get addQueueMembers(): FormArray {
    return this.addQueueForm.get('members') as FormArray;
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
    const daysWithSlots = new Set(this.monthSlots().map((s) => s.date).filter((d): d is string => !!d));
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

  constructor() {
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
        this.mode.set('walk-in');
        this.addQueueMembers.clear();
        this.addQueueMembers.push(this._buildWalkInRow(this.staffServices()[0]?.serviceId ?? ''));
        this.viewedMonth.set(startOfMonth(new Date()));
        // Auto-select today so Time is visible immediately once appointment
        // mode is entered, not only after a manual day tap.
        this.selectedDate.set(this.minDate);
        this.monthSlots.set([]);
        this.selectedStartTime.set(null);
        this.appointmentMembers.clear();
        this.appointmentMembers.push(this._buildAppointmentRow(this.staffServices()[0]?.serviceId ?? ''));
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
    const rows = this.addQueueMembers.value as { name: string; serviceId: string; phone: string }[];
    const valid = rows.filter((r) => r.name?.trim());
    if (valid.length === 0) return;
    this.console.staffAddToQueue(
      this.salonId(),
      this.queueId(),
      valid.map((r) => ({
        memberName: r.name.trim(),
        serviceId: r.serviceId || undefined,
        ...(r.phone?.trim() ? { phone: r.phone.trim() } : {}),
      })),
      () => this.closed.emit(),
    );
  }

  protected addWalkInRow(): void {
    this.addQueueMembers.push(this._buildWalkInRow(this.staffServices()[0]?.serviceId ?? ''));
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

  protected addAppointmentRow(): void {
    this.appointmentMembers.push(this._buildAppointmentRow());
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
      return;
    }
    const rows = this.appointmentMembers.value as { name: string; serviceId: string }[];
    const valid = rows.filter((r) => r.name?.trim() && r.serviceId);
    if (valid.length === 0) return;

    this.console.staffBookAppointment(
      this.salonId(),
      this.queueId(),
      date,
      startTime,
      valid.map((r) => ({ memberName: r.name.trim(), serviceId: r.serviceId })),
      () => this.closed.emit(),
      // On failure, stay open on the appointment step (e.g. slot was just
      // taken) so the barber can pick another — refetch to show current slots.
      () => this._fetchMonth(),
    );
  }

  private _fetchMonth(): void {
    const month = this.viewedMonth();
    const from = toIsoDate(new Date(month.getFullYear(), month.getMonth(), 1));
    const to = toIsoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
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

  private _buildWalkInRow(serviceId = '') {
    return this._fb.group({ name: ['', Validators.required], serviceId: [serviceId], phone: [''] });
  }

  private _buildAppointmentRow(serviceId = '') {
    return this._fb.group({
      name: ['', Validators.required],
      serviceId: [serviceId, Validators.required],
    });
  }
}
