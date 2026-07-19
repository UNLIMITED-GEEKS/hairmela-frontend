import { Component, DestroyRef, inject, input, output, signal, effect, untracked } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { AvailableSlotDto } from '../../../api/models/available-slot-dto';
import { availabilityControllerGetSlots } from '../../../api/fn/schedules/availability-controller-get-slots';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';

function todayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Extracted from queue-list.component.ts's formerly-inline "Add Queue Modal"
// — same walk-in form/behavior, now with a mode toggle so a barber can
// switch to booking an appointment on a client's behalf without leaving the
// modal. Appointment mode reuses the date/slot-picker pattern from
// book-appointment-dialog.component.ts (the customer-facing equivalent) but
// posts to the staff-add appointment route instead.
@Component({
  selector: 'app-add-client-modal',
  templateUrl: './add-client-modal.component.html',
  imports: [ReactiveFormsModule, FieldErrorComponent],
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

  // ── Appointment mode ─────────────────────────────────────────────────────
  protected readonly minDate = todayIsoDate();
  protected readonly date = signal(this.minDate);
  protected readonly slots = signal<AvailableSlotDto[]>([]);
  protected readonly slotsLoading = signal(false);
  protected readonly selectedStartTime = signal<string | null>(null);

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
        this.date.set(this.minDate);
        this.slots.set([]);
        this.selectedStartTime.set(null);
        this.appointmentMembers.clear();
        this.appointmentMembers.push(this._buildAppointmentRow(this.staffServices()[0]?.serviceId ?? ''));
      });
    });
  }

  protected setMode(mode: 'walk-in' | 'appointment'): void {
    this.mode.set(mode);
    if (mode === 'appointment' && this.slots().length === 0 && !this.slotsLoading()) {
      this._fetchSlots();
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

  protected onDateChange(value: string): void {
    this.date.set(value);
    this.selectedStartTime.set(null);
    this._fetchSlots();
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
    console.log('[AddClientModal] staffBookAppointment() called');
    const startTime = this.selectedStartTime();
    console.log('[AddClientModal] startTime =', startTime);
    if (!startTime) {
      console.log('[AddClientModal] BLOCKED: no startTime');
      return;
    }
    console.log('[AddClientModal] appointmentMembers.invalid =', this.appointmentMembers.invalid);
    console.log('[AddClientModal] appointmentMembers.value =', this.appointmentMembers.value);
    console.log('[AddClientModal] appointmentForm.invalid =', this.appointmentForm.invalid);
    if (this.appointmentMembers.invalid) {
      console.log('[AddClientModal] BLOCKED: invalid, per-row errors:',
        (this.appointmentMembers.controls as ReturnType<typeof this._buildAppointmentRow>[]).map((c) => ({
          name: c.get('name')?.errors,
          serviceId: c.get('serviceId')?.errors,
        })));
      this.appointmentMembers.markAllAsTouched();
      return;
    }
    const rows = this.appointmentMembers.value as { name: string; serviceId: string }[];
    const valid = rows.filter((r) => r.name?.trim() && r.serviceId);
    if (valid.length === 0) return;

    this.console.staffBookAppointment(
      this.salonId(),
      this.queueId(),
      this.date(),
      startTime,
      valid.map((r) => ({ memberName: r.name.trim(), serviceId: r.serviceId })),
      () => this.closed.emit(),
      // On failure, stay open on the appointment step (e.g. slot was just
      // taken) so the barber can pick another — refetch to show current slots.
      () => this._fetchSlots(),
    );
  }

  private _fetchSlots(): void {
    this.slotsLoading.set(true);
    this.slots.set([]);
    availabilityControllerGetSlots(this._http, this._apiConfig.rootUrl, {
      salonId: this.salonId(),
      staffId: this.staffId(),
      date: this.date(),
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.slots.set(res.body);
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
