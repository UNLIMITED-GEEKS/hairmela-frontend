import { Component, DestroyRef, inject, input, output, signal, computed, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SalonVisitService } from '../salon-visit.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { AvailableSlotDto } from '../../../api/models/available-slot-dto';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RoutePath } from '../../../core/routing/route-paths';

function todayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Customer-facing appointment booking: [pick a staff member, when none was
// pre-selected] -> date -> slot (from the availability endpoint) -> service
// for yourself + optional extra party members (each with a REQUIRED service,
// unlike join-dialog's optional-per-kid service — an appointment must know
// every member's service up front so the slot's real duration is known
// before it's reserved). Opened from the live-queue page's "Book an
// appointment" section (staff already known — `staff` input passed) OR from
// the salon-landing page's "Book ahead" button, shown only while the salon
// is closed (no staff known yet — `staff` omitted, the dialog's own
// staff-picker step resolves one from `staffList` before the rest of the
// flow proceeds). Only ever for a signed-in customer (BookingController
// requires JwtAuthGuard — no guest path exists here, unlike joining a
// walk-in queue), so the leader is always the signed-in user, never a name
// field — same self-is-the-leader pattern as join-dialog.
@Component({
  selector: 'app-book-appointment-dialog',
  templateUrl: './book-appointment-dialog.component.html',
  imports: [ReactiveFormsModule, FieldErrorComponent],
})
export class BookAppointmentDialogComponent {
  readonly open = input.required<boolean>();
  readonly salonId = input.required<string>();
  readonly slug = input.required<string>();
  // Pre-selected when opened from a barber's own live-queue page. Omitted
  // when opened from the salon-landing page's "Book ahead" button — the
  // staff-picker step below resolves one from staffList() instead.
  readonly staff = input<SalonPublicStaffDto | null>(null);
  // Needed only for the staff-picker path (staff() is empty) — the landing
  // page already has the full list loaded via visit.staffList(), so no
  // extra fetch, just passed straight through.
  readonly staffList = input<SalonPublicStaffDto[]>([]);

  readonly closed = output<void>();

  protected readonly visit = inject(SalonVisitService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly minDate = todayIsoDate();
  protected readonly date = signal(this.minDate);
  protected readonly slots = signal<AvailableSlotDto[]>([]);
  protected readonly slotsLoading = signal(false);
  protected readonly selectedStartTime = signal<string | null>(null);

  // The staff member actually being booked — either passed in directly, or
  // picked by the user in the picker step below.
  protected readonly pickedStaff = signal<SalonPublicStaffDto | null>(null);
  protected readonly selectedStaff = computed(() => this.staff() ?? this.pickedStaff());
  protected readonly needsStaffPicker = computed(() => !this.staff());

  protected readonly staffServices = () => {
    const staff = this.selectedStaff();
    return staff ? this.visit.staffServices(staff) : [];
  };

  protected get leaderName(): string {
    return this._currentUser.user()?.firstName ?? 'You';
  }

  // The leader (signed-in user)'s chosen service — a plain signal, same
  // pattern as join-dialog's leaderServiceId, not part of the members
  // FormArray (which only ever holds EXTRA party members).
  protected readonly leaderServiceId = signal('');
  protected readonly leaderServiceTouched = signal(false);

  protected readonly membersForm = this._fb.group({
    members: this._fb.array<ReturnType<typeof this._buildMemberGroup>>([]),
  });

  protected get membersArray(): FormArray {
    return this.membersForm.get('members') as FormArray;
  }

  constructor() {
    // Reset every time the dialog opens, mirroring join-dialog's own reset
    // effect — no stale date/slot/members from a prior open. Deliberately
    // reads ONLY this.open() as its tracked dependency — untracked() wraps
    // everything else because _fetchSlots() reads this.date() internally,
    // and an effect tracks every signal read during its execution, including
    // reads that happen inside a called function. Without untracked(), this
    // effect was accidentally also depending on `date`, so onDateChange()'s
    // this.date.set(value) retriggered THIS effect, which immediately reset
    // date back to minDate before the user's selection could ever be used —
    // the appointment was always booked for today regardless of the picked date.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.date.set(this.minDate);
        this.slots.set([]);
        this.selectedStartTime.set(null);
        this.leaderServiceId.set('');
        this.leaderServiceTouched.set(false);
        this.pickedStaff.set(null);
        this.membersArray.clear();
        // Only fetch if a staff member is already known — the staff-picker
        // path (needsStaffPicker()) has nothing to fetch availability for
        // yet; pickStaff() triggers the fetch once one is chosen.
        if (this.selectedStaff()) this._fetchSlots();
      });
    });
  }

  protected pickStaff(staff: SalonPublicStaffDto): void {
    this.pickedStaff.set(staff);
    this.date.set(this.minDate);
    this.selectedStartTime.set(null);
    this.leaderServiceId.set('');
    this._fetchSlots();
  }

  protected onDateChange(value: string): void {
    this.date.set(value);
    this.selectedStartTime.set(null);
    this._fetchSlots();
  }

  protected selectSlot(slot: AvailableSlotDto): void {
    this.selectedStartTime.set(slot.startTime);
  }

  protected addMember(): void {
    if (this.membersArray.length >= this.visit.maxPartySize() - 1) return;
    this.membersArray.push(this._buildMemberGroup(this.leaderServiceId()));
  }

  protected removeMember(i: number): void {
    this.membersArray.removeAt(i);
  }

  protected cancel(): void {
    this.closed.emit();
  }

  protected confirmBooking(): void {
    const staff = this.selectedStaff();
    const queueId = staff?.queueId;
    if (!staff || !queueId) return;
    const startTime = this.selectedStartTime();
    if (!startTime) return;
    if (!this.leaderServiceId()) {
      this.leaderServiceTouched.set(true);
      return;
    }
    if (this.membersArray.invalid) {
      this.membersArray.markAllAsTouched();
      return;
    }

    const extras = (this.membersArray.value as { name: string; serviceId: string }[])
      .filter((m) => m.name?.trim() && m.serviceId)
      .map((m) => ({ name: m.name.trim(), serviceId: m.serviceId }));
    const members = [{ name: this.leaderName, serviceId: this.leaderServiceId() }, ...extras];

    this.closed.emit();
    this.visit.bookAppointment(
      this.salonId(),
      queueId,
      this.slug(),
      this.date(),
      startTime,
      members,
    );
    // Navigate immediately (navigation-is-feedback, same pattern as
    // join-dialog's /joining redirect) — My Queues renders the new
    // appointment once bookAppointment()'s request resolves; a failure
    // surfaces via the toast bookAppointment() already fires, not a stuck
    // loading state on this page the user has already left.
    this._router.navigate(RoutePath.queues());
  }

  private _fetchSlots(): void {
    const staff = this.selectedStaff();
    if (!staff) return;
    this.slotsLoading.set(true);
    this.slots.set([]);
    this.visit
      .getAvailability(this.salonId(), staff.staffId, this.date())
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (slots) => {
          this.slots.set(slots);
          this.slotsLoading.set(false);
        },
        error: () => this.slotsLoading.set(false),
      });
  }

  private _buildMemberGroup(serviceId = '') {
    return this._fb.group({
      name: ['', Validators.required],
      serviceId: [serviceId, Validators.required],
    });
  }
}
