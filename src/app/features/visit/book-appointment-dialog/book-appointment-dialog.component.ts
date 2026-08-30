import { Component, inject, input, output, signal, computed, effect, untracked,
  ElementRef,
  Injector,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';
import { SalonVisitService } from '../salon-visit.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { SlotPickerComponent } from '../../../shared/components/slot-picker/slot-picker.component';
import { toIsoDate } from '../../../shared/components/slot-picker/iso-date';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { StaffCardComponent } from '../../../shared/components/staff-card/staff-card.component';
import { RoutePath } from '../../../core/routing/route-paths';
import { groupByServiceCategory } from '../../../core/utils/group-by-category';
import { Service } from '../../../api/models/service';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';
import { BookingFeeStepComponent } from '../booking-fee-step/booking-fee-step.component';
import { scrollToNewRow } from '../../../core/utils/scroll-to-new-row';

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
  imports: [
    ReactiveFormsModule,
    FieldErrorComponent,
    SlotPickerComponent,
    AccordionComponent,
    InlineSpinnerComponent,
    StaffCardComponent,
    BookingFeeStepComponent,
  ],
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
  private readonly _fieldsEl = viewChild<ElementRef<HTMLElement>>('fieldsEl');
  private readonly _memberRows = viewChild<ElementRef<HTMLElement>>('memberRows');
  private readonly _scrollInjector = inject(Injector);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);

  protected readonly minDate = toIsoDate(new Date());
  // Owned here (this is what gets submitted), but CHOSEN by app-slot-picker,
  // which two-way binds them. The month/availability/slot-grid machinery all
  // lives in that component now.
  protected readonly selectedDate = signal<string | null>(null);
  protected readonly selectedStartTime = signal<string | null>(null);
  // Bumped to tell the slot picker to reset and refetch — on open, and when
  // the staff-picker path resolves a staff member.
  protected readonly slotResetToken = signal(0);

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

  // The leader (signed-in user)'s chosen services — a plain signal, same
  // pattern as join-dialog's leaderServiceIds, not part of the members
  // FormArray (which only ever holds EXTRA party members).
  //
  // A LIST because one person can book several services in a single visit;
  // each becomes its own members[] entry sharing their name, and so counts
  // separately against maxPartySize. Index 0 is the primary one.
  // FIXME: the leader's services are a plain signal + hand-wired <select>,
  // while every OTHER member is a FormArray row with formControlName. Two
  // mechanisms for one concept in a single form, and only this half carries
  // the bugs that come with driving a <select> by hand:
  //
  //   * [value] writes only when the bound value CHANGES, so a <select>
  //     recreated by the step @if (going to the part-payment step and back)
  //     came back showing its first option. Fixed by binding [selected] per
  //     option in the template.
  //   * a <select> cannot hold a value with no matching <option>, so opening
  //     before the services load dropped a pre-filled ?serviceId=. Fixed by
  //     _applyInitialServiceOnLoad below.
  //
  // Angular's SelectControlValueAccessor already handles BOTH cases, and the
  // member rows have never hit either. The real fix is to make the leader a
  // FormArray row like everyone else and delete the manual binding plus both
  // workarounds above — not a third patch when the next symptom appears.
  //
  // Deferred because it spans this dialog and book-appointment-dialog, and
  // touches the submit path and the maxPartySize counting; it wants doing
  // deliberately with the booking flow retestable, the way the slot-picker
  // extraction was.
  protected readonly leaderServiceIds = signal<string[]>(['']);
  protected readonly leaderServiceTouched = signal(false);

  // ── Booking fee step ──────────────────────────────────────────────────────
  // Same two-step shape as join-dialog: salons with enforceBookingFee on get a
  // quote -> pay -> receipt step between this form and the actual booking.
  protected readonly step = signal<'form' | 'fee'>('form');
  private readonly _pendingMembers = signal<{ name: string; serviceId: string }[] | null>(null);
  private readonly _pendingNote = signal<{ body: string; image: File | null } | undefined>(undefined);

  /** One id per member — the same list the quote and receipt check both use. */
  protected readonly pendingServiceIds = computed(() =>
    (this._pendingMembers() ?? []).map((m) => m.serviceId),
  );

  /** The queue this booking lands in — the chosen staff member's own. */
  protected readonly feeQueueId = computed(() => this.selectedStaff()?.queueId ?? '');

  /** Total services across the leader and every extra member. */
  // Plain GETTERS, not computed(): these read a FormArray's length, which
  // is not a signal, so a computed() would cache the first value and never
  // see a person being added — the cap silently stopped applying. Getters
  // re-evaluate on each change-detection pass, which is how the template's
  // own `kidsArray.length` checks already work (and what add-client-modal
  // does for the same reason).
  protected get totalServices(): number {
    return this.leaderServiceIds().length + this.extraServiceCount();
  }

  protected get atMaxPartySize(): boolean {
    return this.totalServices >= this.visit.maxPartySize();
  }

  protected readonly membersForm = this._fb.group({
    members: this._fb.array<ReturnType<typeof this._buildMemberGroup>>([]),
  });

  protected get membersArray(): FormArray {
    return this.membersForm.get('members') as FormArray;
  }

  constructor() {
    // Android back dismisses this dialog instead of navigating underneath it.
    registerOverlayWhileOpen(this.open, () => this.cancel());

    // Reset every time the dialog opens, mirroring join-dialog's own reset
    // effect — no stale members/notes from a prior open. Slot state (month,
    // availability, chosen day/time) resets itself via slotResetToken; the
    // picker also holds the untracked() guard that keeps a month change from
    // snapping back to the current month.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.step.set('form');
        this._pendingMembers.set(null);
        this._pendingNote.set(undefined);
        this.leaderServiceIds.set(['']);
        this.leaderServiceTouched.set(false);
        this.pickedStaff.set(null);
        this.pickerServiceId.set(null);
        this.membersArray.clear();
        this.noteBody.set('');
        this._clearNoteImage();
        this.slotResetToken.update((n) => n + 1);
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
    // Carry the already-chosen service forward — the customer picked WHAT
    // before WHO, so re-asking for the same service on the next screen would
    // be redundant. Only meaningful for this (service-first) path;
    // pickerServiceId is null when staff() was pre-known.
    this.leaderServiceIds.set([this.pickerServiceId() ?? '']);
    // The picker keys its fetch off staffId too, but bump the token as well so
    // re-picking the SAME staff member still resets the chosen day/time.
    this.slotResetToken.update((n) => n + 1);
  }

  protected addMember(): void {
    if (this.atMaxPartySize) return;
    this.membersArray.push(this._buildMemberGroup(this.leaderServiceIds()[0] ?? ''));
    // Deferred: the row does not exist in the DOM until Angular has rendered
    // the FormArray change.
    afterNextRender(
      () => scrollToNewRow(this._memberRows()?.nativeElement),
      { injector: this._scrollInjector },
    );
  }

  protected removeMember(i: number): void {
    this.membersArray.removeAt(i);
  }

  // ── Multiple services per person ─────────────────────────────────────────

  protected setLeaderServiceAt(index: number, serviceId: string): void {
    this.leaderServiceIds.update((ids) => ids.map((id, i) => (i === index ? serviceId : id)));
  }

  protected addLeaderService(): void {
    if (this.atMaxPartySize) return;
    this.leaderServiceIds.update((ids) => [...ids, '']);
  }

  protected removeLeaderService(index: number): void {
    // Never leave the leader with no service row — the first one stays.
    this.leaderServiceIds.update((ids) => (ids.length <= 1 ? ids : ids.filter((_, i) => i !== index)));
  }

  protected memberServiceIds(i: number): FormArray {
    return this.membersArray.at(i).get('serviceIds') as FormArray;
  }

  protected addMemberService(i: number): void {
    if (this.atMaxPartySize) return;
    this.memberServiceIds(i).push(this._fb.control('', Validators.required));
  }

  protected removeMemberService(i: number, serviceIndex: number): void {
    const ids = this.memberServiceIds(i);
    if (ids.length <= 1) return;
    ids.removeAt(serviceIndex);
  }

  protected extraServiceCount(): number {
    return this.membersArray.controls.reduce((total, row) => {
      const ids = (row.get('serviceIds') as FormArray | null)?.length ?? 0;
      return total + Math.max(ids, 1);
    }, 0);
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
    // Both branches scroll: the offending field is often below the dialog's
    // fold, and without this the Book button reads as doing nothing.
    if (!this.leaderServiceIds().some((id) => !!id)) {
      this.leaderServiceTouched.set(true);
      this._scrollToFirstError();
      return;
    }
    if (this.membersArray.invalid) {
      this.membersArray.markAllAsTouched();
      this._scrollToFirstError();
      return;
    }

    // One members[] entry per service, all sharing that person's name — the
    // backend counts these individually against maxPartySize.
    const extras = (this.membersArray.value as { name: string; serviceIds: string[] }[])
      .filter((m) => m.name?.trim())
      .flatMap((m) =>
        (m.serviceIds ?? [])
          .filter((id) => !!id)
          .map((serviceId) => ({ name: m.name.trim(), serviceId })),
      );
    const leaderEntries = this.leaderServiceIds()
      .filter((id) => !!id)
      .map((serviceId) => ({ name: this.leaderName, serviceId }));
    const members = [...leaderEntries, ...extras];

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

    // Salons that charge a fee get a payment step first; the dialog stays open
    // and the booking fires once a receipt is accepted.
    if (this.visit.enforcesBookingFee()) {
      this._pendingMembers.set(members);
      this._pendingNote.set(note);
      this.step.set('fee');
      return;
    }

    this._book(members, note);
  }

  /**
   * Fee step finished — receipt accepted (id present), or the salon turned out
   * not to be charging (null). Either way the booking proceeds.
   */
  protected onFeeVerified(receiptVerificationId: string | null): void {
    const members = this._pendingMembers();
    if (!members) return;
    this._book(members, this._pendingNote(), receiptVerificationId ?? undefined);
  }

  protected backToForm(): void {
    this.step.set('form');
  }

  private _book(
    members: { name: string; serviceId: string }[],
    note?: { body: string; image: File | null },
    receiptVerificationId?: string,
  ): void {
    const queueId = this.selectedStaff()?.queueId;
    const date = this.selectedDate();
    const startTime = this.selectedStartTime();
    if (!queueId || !date || !startTime) return;

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
      receiptVerificationId,
    );
  }

  private _buildMemberGroup(serviceId = '') {
    return this._fb.group({
      name: ['', Validators.required],
      serviceIds: this._fb.array([this._fb.control(serviceId, Validators.required)]),
    });
  }

  private _scrollToFirstError(): void {
    afterNextRender(() => scrollToFirstInvalidControl(this._fieldsEl()?.nativeElement), {
      injector: this._scrollInjector,
    });
  }

}
