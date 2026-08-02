import { Component, DestroyRef, inject, input, output, signal, computed, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SalonVisitService } from '../salon-visit.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { AvailableSlotDto } from '../../../api/models/available-slot-dto';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { MiniMonthCalendarComponent } from '../../../shared/components/mini-month-calendar/mini-month-calendar.component';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { RoutePath } from '../../../core/routing/route-paths';
import { groupByServiceCategory } from '../../../core/utils/group-by-category';
import { Service } from '../../../api/models/service';

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const ALLOWED_NOTE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_NOTE_IMAGE_BYTES = 5 * 1024 * 1024;

// Customer-facing appointment booking: [pick a staff member, when none was
// pre-selected] -> month-grid date picker -> slot -> service for yourself +
// optional extra party members (each with a REQUIRED service, unlike
// join-dialog's optional-per-kid service — an appointment must know every
// member's service up front so the slot's real duration is known before
// it's reserved). Opened from the live-queue page's "Book an appointment"
// section (staff already known — `staff` input passed) OR from the
// salon-landing page's "Book ahead" button, shown only while the salon is
// closed (no staff known yet — `staff` omitted, the dialog's own
// staff-picker step resolves one from `staffList` before the rest of the
// flow proceeds). Only ever for a signed-in customer (BookingController
// requires JwtAuthGuard — no guest path exists here, unlike joining a
// walk-in queue), so the leader is always the signed-in user, never a name
// field — same self-is-the-leader pattern as join-dialog.
//
// Availability is fetched a WHOLE MONTH at a time (getAvailabilityRange) and
// re-fetched only when the visible month changes — not on every day click —
// per the product call: this is live bookable-slot data, so it's never
// cached across sessions/components (unlike AppointmentsCalendarService's
// booked-appointment history), but batching the fetch per-month instead of
// per-day is purely a request-count optimization, not a staleness risk,
// since the whole month's slots are always freshly fetched together.
@Component({
  selector: 'app-book-appointment-dialog',
  templateUrl: './book-appointment-dialog.component.html',
  imports: [ReactiveFormsModule, FieldErrorComponent, MiniMonthCalendarComponent, AccordionComponent],
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

  protected readonly minDate = toIsoDate(new Date());
  protected readonly viewedMonth = signal(startOfMonth(new Date()));
  protected readonly selectedDate = signal<string | null>(null);
  protected readonly monthSlots = signal<AvailableSlotDto[]>([]);
  protected readonly slotsLoading = signal(false);
  protected readonly selectedStartTime = signal<string | null>(null);

  // Which days in the visible month have at least one bookable slot — feeds
  // MiniMonthCalendarComponent's badge dots, same as the barber calendar's
  // appointment-count badge but here it's "has availability" (0 or 1).
  protected readonly badgeFor = computed(() => {
    const daysWithSlots = new Set(this.monthSlots().map((s) => s.date).filter((d): d is string => !!d));
    return (iso: string) => (daysWithSlots.has(iso) ? 1 : 0);
  });

  protected readonly selectedDaySlots = computed<AvailableSlotDto[]>(() => {
    const day = this.selectedDate();
    if (!day) return [];
    return this.monthSlots().filter((s) => s.date === day);
  });

  // The staff member actually being booked — either passed in directly, or
  // picked by the user in the picker step below.
  protected readonly pickedStaff = signal<SalonPublicStaffDto | null>(null);
  protected readonly selectedStaff = computed(() => this.staff() ?? this.pickedStaff());
  protected readonly needsStaffPicker = computed(() => !this.staff());

  // Service-first staff picker (Book ahead entry, staff() unset): the
  // customer picks WHAT they want done before WHO does it, rather than
  // picking a staff member blind. Only relevant while needsStaffPicker() —
  // when staff() is already known (live-queue page's own "Book an
  // appointment"), the flow is unchanged: date -> time -> service straight
  // away, since who is fixed already.
  protected readonly pickerServiceId = signal<string | null>(null);
  protected readonly staffOfferingPickerService = computed(() => {
    const serviceId = this.pickerServiceId();
    if (!serviceId) return [];
    return this.staffList().filter((s) => s.serviceIds.includes(serviceId));
  });

  // Service picker grouped by category — same grouping (extracted to
  // groupByServiceCategory) and open/collapse rule used by salon-landing's
  // Services tab and the join/add-client dropdowns: a single category is
  // always expanded, multiple start collapsed, explicit toggles remembered
  // here rather than recomputed.
  protected readonly pickerServiceGroups = computed(() =>
    groupByServiceCategory(this.visit.services(), (s: Service) => s),
  );
  private readonly _openPickerCategoryIds = signal<ReadonlySet<string>>(new Set());

  protected isPickerCategoryOpen(categoryId: string): boolean {
    if (this.pickerServiceGroups().length <= 1) return true;
    return this._openPickerCategoryIds().has(categoryId);
  }

  protected setPickerCategoryOpen(categoryId: string, open: boolean): void {
    this._openPickerCategoryIds.update((ids) => {
      const next = new Set(ids);
      open ? next.add(categoryId) : next.delete(categoryId);
      return next;
    });
  }

  protected readonly staffServices = () => {
    const staff = this.selectedStaff();
    return staff ? this.visit.staffServices(staff) : [];
  };

  // One-shot note at intake — same write-only pattern as join-dialog's; sent
  // as the first comment once the entry exists, not rendered in this dialog.
  protected readonly noteBody = signal('');
  protected readonly noteImage = signal<File | null>(null);
  protected readonly noteImagePreviewUrl = signal<string | null>(null);
  protected readonly noteImageError = signal<string | null>(null);

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
    // effect — no stale month/slot/members from a prior open. Deliberately
    // reads ONLY this.open() as its tracked dependency — untracked() wraps
    // everything else because _fetchMonth() reads this.viewedMonth()
    // internally, and an effect tracks every signal read during its
    // execution, including reads that happen inside a called function.
    // Without untracked(), this effect would also depend on `viewedMonth`,
    // so onMonthChange()'s viewedMonth.set(...) would retrigger THIS effect
    // and immediately reset the month back to the current one — see the
    // identical bug this exact pattern fixed for the old single-date input.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.viewedMonth.set(startOfMonth(new Date()));
        // Auto-select today so the Time section is visible immediately, not
        // only after a manual day tap.
        this.selectedDate.set(this.minDate);
        this.monthSlots.set([]);
        this.selectedStartTime.set(null);
        this.leaderServiceId.set('');
        this.leaderServiceTouched.set(false);
        this.pickedStaff.set(null);
        this.pickerServiceId.set(null);
        this.membersArray.clear();
        this.noteBody.set('');
        this._clearNoteImage();
        // Only fetch if a staff member is already known — the staff-picker
        // path (needsStaffPicker()) has nothing to fetch availability for
        // yet; pickStaff() triggers the fetch once one is chosen.
        if (this.selectedStaff()) this._fetchMonth();
      });
    });
  }

  protected pickPickerService(serviceId: string): void {
    this.pickerServiceId.set(serviceId);
  }

  protected backToServicePicker(): void {
    this.pickerServiceId.set(null);
  }

  protected pickStaff(staff: SalonPublicStaffDto): void {
    this.pickedStaff.set(staff);
    this.viewedMonth.set(startOfMonth(new Date()));
    this.selectedDate.set(this.minDate);
    this.selectedStartTime.set(null);
    // Carry the already-chosen service forward — the customer picked WHAT
    // before WHO, so re-asking for the same service on the next screen would
    // be redundant. Only meaningful for this (service-first) path;
    // pickerServiceId is null when staff() was pre-known.
    this.leaderServiceId.set(this.pickerServiceId() ?? '');
    this._fetchMonth();
  }

  protected onMonthChange(month: Date): void {
    this.viewedMonth.set(month);
    // Auto-select the 1st of the newly-visible month so Time stays visible
    // without an extra manual day tap after navigating.
    this.selectedDate.set(toIsoDate(new Date(month.getFullYear(), month.getMonth(), 1)));
    this.selectedStartTime.set(null);
    this._fetchMonth();
  }

  protected onDaySelect(iso: string): void {
    // No toggle-off — a day is always selected once the dialog is open (auto-
    // selected on open/month-change), so Time stays visible; re-tapping the
    // same day is a no-op instead of hiding the section again.
    this.selectedDate.set(iso);
    this.selectedStartTime.set(null);
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

  protected onNoteImagePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    if (!ALLOWED_NOTE_IMAGE_TYPES.includes(file.type)) {
      this.noteImageError.set('Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    if (file.size > MAX_NOTE_IMAGE_BYTES) {
      this.noteImageError.set('Image must be 5 MB or smaller.');
      return;
    }

    this.noteImageError.set(null);
    this._clearNoteImage();
    this.noteImage.set(file);
    this.noteImagePreviewUrl.set(URL.createObjectURL(file));
  }

  protected removeNoteImage(): void {
    this._clearNoteImage();
  }

  private _clearNoteImage(): void {
    const url = this.noteImagePreviewUrl();
    if (url) URL.revokeObjectURL(url);
    this.noteImagePreviewUrl.set(null);
    this.noteImage.set(null);
    this.noteImageError.set(null);
  }

  protected cancel(): void {
    this.closed.emit();
  }

  protected confirmBooking(): void {
    const staff = this.selectedStaff();
    const queueId = staff?.queueId;
    if (!staff || !queueId) return;
    const date = this.selectedDate();
    const startTime = this.selectedStartTime();
    if (!date || !startTime) return;
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

    // Navigate only after the booking POST resolves (not immediately, unlike
    // join-dialog's /joining redirect) — this dialog stays open with its
    // existing disabled "Booking…" button state in the meantime. Navigating
    // early used to race My Queues' own mount-time fetch: that fetch would
    // frequently land before the booking POST finished server-side, painting
    // a list missing the new appointment, then a second corrective fetch
    // (triggered by bookAppointment()'s own refresh() call) would fix it a
    // moment later — a visible flash on every booking. Waiting for onSuccess
    // means My Queues' first fetch only ever happens after the entry already
    // exists, so it's correct on the first try.
    const note =
      this.noteBody().trim() || this.noteImage()
        ? { body: this.noteBody().trim(), image: this.noteImage() }
        : undefined;

    this.visit.bookAppointment(
      this.salonId(),
      queueId,
      this.slug(),
      date,
      startTime,
      members,
      undefined,
      () => {
        this.closed.emit();
        this._router.navigate(RoutePath.queues());
      },
      note,
    );
  }

  private _fetchMonth(): void {
    const staff = this.selectedStaff();
    if (!staff) return;
    const month = this.viewedMonth();
    const from = toIsoDate(new Date(month.getFullYear(), month.getMonth(), 1));
    const to = toIsoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    this.slotsLoading.set(true);
    this.monthSlots.set([]);
    this.visit
      .getAvailabilityRange(this.salonId(), staff.staffId, from, to)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (slots) => {
          this.monthSlots.set(slots);
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
