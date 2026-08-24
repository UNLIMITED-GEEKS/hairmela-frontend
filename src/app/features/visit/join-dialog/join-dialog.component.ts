import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonVisitService } from '../salon-visit.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { JoinMemberDto } from '../../../api/models/join-member-dto';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';
import { RoutePath } from '../../../core/routing/route-paths';
import { groupByServiceCategory } from '../../../core/utils/group-by-category';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';
import { Service } from '../../../api/models/service';
import { BookingFeeStepComponent } from '../booking-fee-step/booking-fee-step.component';

const ALLOWED_NOTE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_NOTE_IMAGE_BYTES = 5 * 1024 * 1024;

// Shared join dialog: guest name/phone (guests only), a required service for
// the leader, + optional party members (kids), submitted as one batch join.
// Opened from the live queue page's Join button, once a staff member + queue
// are known — owns its own form state and the full submit -> /joining
// navigation, so the caller only toggles `open` and reacts to `closed`.
@Component({
  selector: 'app-join-dialog',
  templateUrl: './join-dialog.component.html',
  imports: [ReactiveFormsModule, FieldErrorComponent, BookingFeeStepComponent],
})
export class JoinDialogComponent {
  readonly open = input.required<boolean>();
  readonly salonId = input.required<string>();
  readonly queueId = input.required<string>();
  readonly slug = input.required<string>();
  readonly shellPrefix = input<string>('');
  readonly staff = input.required<SalonPublicStaffDto>();
  // Pre-fill only — e.g. arriving from the landing page's Services tab with a
  // service already chosen. The dialog always shows the field and always
  // requires a value before a join can be submitted, regardless of this input.
  readonly initialServiceId = input<string | null>(null);

  readonly closed = output<void>();

  protected readonly visit = inject(SalonVisitService);
  private readonly _fieldsEl = viewChild<ElementRef<HTMLElement>>('fieldsEl');
  private readonly _scrollInjector = inject(Injector);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _fb = inject(FormBuilder);

  protected readonly guestName = signal('');
  protected readonly guestPhone = signal('');
  protected readonly guestNameTouched = signal(false);
  protected readonly guestPhoneTouched = signal(false);
  // The joining customer's services. A list, not a single id: one person can
  // book several services in one visit, and each becomes its own members[]
  // entry sharing their name. Index 0 is the primary one.
  protected readonly leaderServiceIds = signal<string[]>(['']);
  protected readonly leaderServiceTouched = signal(false);

  // ── Booking fee step ──────────────────────────────────────────────────────
  // Salons with enforceBookingFee on get a payment step between the form and
  // the actual join: quote -> pay the salon directly -> upload receipt. The
  // form step keeps everything it had; only the button changes ("Next" instead
  // of "Join queue") and a second step follows.
  protected readonly step = signal<'form' | 'fee'>('form');
  // Held from the moment the form is validated until the join fires, because
  // the fee step needs the exact same service ids the quote was made with.
  private readonly _pendingMembers = signal<JoinMemberDto[] | null>(null);
  private readonly _pendingNote = signal<{ body: string; image: File | null } | undefined>(undefined);

  /** The ids sent to both the quote and the receipt check — one per member. */
  protected readonly pendingServiceIds = computed(() =>
    (this._pendingMembers() ?? [])
      .map((m) => m.serviceId)
      .filter((id): id is string => !!id),
  );

  /** Total services across the leader and every kid — what maxPartySize caps. */
  // Plain GETTERS, not computed(): these read a FormArray's length, which
  // is not a signal, so a computed() would cache the first value and never
  // see a person being added — the cap silently stopped applying. Getters
  // re-evaluate on each change-detection pass, which is how the template's
  // own `kidsArray.length` checks already work (and what add-client-modal
  // does for the same reason).
  protected get totalServices(): number {
    return this.leaderServiceIds().length + this.kidsServiceCount();
  }

  protected get atMaxPartySize(): boolean {
    return this.totalServices >= this.visit.maxPartySize();
  }

  // One-shot note at intake — write-only here; it becomes the first entry in
  // the "View notes" thread on My Position, never rendered in this dialog.
  protected readonly noteBody = signal('');
  protected readonly noteImage = signal<File | null>(null);
  protected readonly noteImagePreviewUrl = signal<string | null>(null);
  protected readonly noteImageError = signal<string | null>(null);

  protected readonly staffServices = computed(() => this.visit.staffServices(this.staff()));
  protected readonly staffServiceGroups = computed(() =>
    groupByServiceCategory(this.staffServices(), (s: Service) => s),
  );

  protected readonly kidsForm = this._fb.group({
    members: this._fb.array<ReturnType<typeof this._buildKidGroup>>([]),
  });

  protected get kidsArray(): FormArray {
    return this.kidsForm.get('members') as FormArray;
  }

  /** Guest = no signed-in user; the dialog then collects name + phone. */
  protected get isGuest(): boolean {
    return !this._currentUser.user();
  }

  constructor() {
    // Android back dismisses this dialog instead of navigating the page
    // underneath it. Its own effect tracks only open(), so it does not
    // interact with the untracked() dance below.
    registerOverlayWhileOpen(this.open, () => this.cancel());

    // Reset form state every time the dialog opens — a signed-in user's name
    // is pre-filled, guests start blank, no stale values from a prior open.
    // Deliberately reads ONLY this.open() as its tracked dependency —
    // untracked() wraps everything else because _clearNoteImage() reads
    // noteImagePreviewUrl() internally, and an effect tracks every signal
    // read during its execution, including reads inside called functions.
    // Without untracked(), this effect also depends on noteImagePreviewUrl,
    // so onNoteImagePicked()'s noteImagePreviewUrl.set(...) retriggers THIS
    // effect and immediately wipes the preview + resets the whole form —
    // same bug this exact pattern already fixed once for
    // BookAppointmentDialogComponent's month/slot state (see its own
    // constructor comment).
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        const user = this._currentUser.user();
        this.guestName.set(user?.firstName ?? '');
        this.guestPhone.set('');
        this.guestNameTouched.set(false);
        this.guestPhoneTouched.set(false);
        this.step.set('form');
        this._pendingMembers.set(null);
        this._pendingNote.set(undefined);
        this.leaderServiceIds.set([this.initialServiceId() ?? '']);
        this.leaderServiceTouched.set(false);
        this.kidsArray.clear();
        this.noteBody.set('');
        this._clearNoteImage();
      });
    });
  }

  protected addKid(): void {
    if (this.atMaxPartySize) return;
    this.kidsArray.push(this._buildKidGroup(this.leaderServiceIds()[0] ?? ''));
  }

  protected removeKid(i: number): void {
    this.kidsArray.removeAt(i);
  }

  // ── Multiple services per person ─────────────────────────────────────────
  // Each service is a separate members[] entry on the wire, sharing that
  // person's name, and so counts separately against maxPartySize.

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

  protected kidServiceIds(i: number): FormArray {
    return this.kidsArray.at(i).get('serviceIds') as FormArray;
  }

  protected addKidService(i: number): void {
    if (this.atMaxPartySize) return;
    this.kidServiceIds(i).push(this._fb.control(''));
  }

  protected removeKidService(i: number, serviceIndex: number): void {
    const ids = this.kidServiceIds(i);
    if (ids.length <= 1) return;
    ids.removeAt(serviceIndex);
  }

  // FormArray length isn't a signal, so this is read during change detection
  // like the template's own kidsArray.length checks — totalServices() reads it
  // to keep the cap honest across both.
  protected kidsServiceCount(): number {
    return this.kidsArray.controls.reduce((total, row) => {
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

  protected confirmJoin(): void {
    if (this.visit.salonData()?.isFrozen) return;

    const leaderName = this.isGuest
      ? this.guestName().trim()
      : (this._currentUser.user()?.firstName ?? '');
    const phone = this.isGuest ? this.guestPhone().trim() : undefined;

    // Mark every field the user has not yet blurred, so its error actually
    // renders. Previously these paths just returned: the errors were gated on
    // `touched`, an untouched field showed nothing, and the button read as
    // broken. A service is mandatory for every join — no path submits without
    // one.
    const missingGuestFields = this.isGuest && (!leaderName || !phone);
    const missingService = !this.leaderServiceIds().some((id) => !!id);
    if (missingGuestFields || missingService || !leaderName) {
      if (this.isGuest) {
        this.guestNameTouched.set(true);
        this.guestPhoneTouched.set(true);
      }
      this.leaderServiceTouched.set(true);
      afterNextRender(() => scrollToFirstInvalidControl(this._fieldsEl()?.nativeElement), {
        injector: this._scrollInjector,
      });
      return;
    }

    // One members[] entry per service, all sharing that person's name — the
    // backend counts these individually against maxPartySize.
    const leaderEntries = this.leaderServiceIds()
      .filter((id) => !!id)
      .map((serviceId): JoinMemberDto => ({ memberName: leaderName, phone, serviceId }));
    const kids = (this.kidsArray.value as { name: string; serviceIds: string[] }[])
      .filter((k) => k.name?.trim())
      .flatMap((k): JoinMemberDto[] => {
        const name = k.name.trim();
        const ids = (k.serviceIds ?? []).filter((id) => !!id);
        // A kid with no service chosen still joins — service is optional here.
        if (ids.length === 0) return [{ memberName: name, serviceId: undefined }];
        return ids.map((serviceId) => ({ memberName: name, serviceId }));
      });

    const note =
      this.noteBody().trim() || this.noteImage()
        ? { body: this.noteBody().trim(), image: this.noteImage() }
        : undefined;

    const members = [...leaderEntries, ...kids];

    // Salons that charge a fee get a payment step first. The dialog stays
    // OPEN here (unlike the direct path below, which closes and navigates) —
    // there is a second step to show.
    if (this.visit.enforcesBookingFee()) {
      this._pendingMembers.set(members);
      this._pendingNote.set(note);
      this.step.set('fee');
      return;
    }

    this.closed.emit();
    this._submitJoin(members, note);
  }

  /**
   * The fee step is done: either the receipt was accepted (id present), or the
   * salon turned out not to be charging after all (null). Either way the join
   * proceeds — the id is what proves payment to the backend.
   */
  protected onFeeVerified(receiptVerificationId: string | null): void {
    const members = this._pendingMembers();
    if (!members) return;
    this.closed.emit();
    this._submitJoin(members, this._pendingNote(), receiptVerificationId ?? undefined);
  }

  protected backToForm(): void {
    this.step.set('form');
  }

  private _submitJoin(
    members: JoinMemberDto[],
    note?: { body: string; image: File | null },
    receiptVerificationId?: string,
  ): void {
    const salonId = this.salonId();
    const queueId = this.queueId();
    const slug = this.slug();
    const prefix = this.shellPrefix();
    if (!salonId || !queueId) return;
    // Belt-and-suspenders: a join is already in flight (pendingJoin is set) means
    // the caller is navigating away — drop any re-entrant call.
    if (this.visit.pendingJoin() !== null) return;

    // Navigate to /joining FIRST (navigation-is-feedback).
    // JoiningQueueComponent reads visit.pendingJoin() and routes to position or back.
    this.visit.pendingJoin.set({ status: 'pending' });
    const joiningUrl = RoutePath.visitJoining(prefix, slug, queueId);
    this._router.navigate(joiningUrl);

    this.visit.joinQueue(salonId, queueId, slug, { members, receiptVerificationId }, note);
  }

  private _buildKidGroup(serviceId = '') {
    return this._fb.group({
      name: ['', Validators.required],
      serviceIds: this._fb.array([this._fb.control(serviceId)]),
    });
  }
}
