import { Component, computed, inject, input, output, signal, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonVisitService } from '../salon-visit.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { JoinMemberDto } from '../../../api/models/join-member-dto';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RoutePath } from '../../../core/routing/route-paths';
import { groupByServiceCategory } from '../../../core/utils/group-by-category';
import { Service } from '../../../api/models/service';

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
  imports: [ReactiveFormsModule, FieldErrorComponent],
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
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _fb = inject(FormBuilder);

  protected readonly guestName = signal('');
  protected readonly guestPhone = signal('');
  protected readonly guestNameTouched = signal(false);
  protected readonly guestPhoneTouched = signal(false);
  protected readonly leaderServiceId = signal('');
  protected readonly leaderServiceTouched = signal(false);

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
        this.leaderServiceId.set(this.initialServiceId() ?? '');
        this.leaderServiceTouched.set(false);
        this.kidsArray.clear();
        this.noteBody.set('');
        this._clearNoteImage();
      });
    });
  }

  protected addKid(): void {
    if (this.kidsArray.length >= this.visit.maxPartySize() - 1) return;
    this.kidsArray.push(this._buildKidGroup(this.leaderServiceId()));
  }

  protected removeKid(i: number): void {
    this.kidsArray.removeAt(i);
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
    if (this.isGuest && (!leaderName || !phone)) return;
    if (!leaderName) return;
    // A service is mandatory for every join — no path submits without one.
    if (!this.leaderServiceId()) {
      this.leaderServiceTouched.set(true);
      return;
    }

    const leader: JoinMemberDto = {
      memberName: leaderName,
      phone,
      serviceId: this.leaderServiceId(),
    };
    const kids = (this.kidsArray.value as { name: string; serviceId: string }[])
      .filter((k) => k.name?.trim())
      .map((k): JoinMemberDto => ({ memberName: k.name.trim(), serviceId: k.serviceId || undefined }));

    const note =
      this.noteBody().trim() || this.noteImage()
        ? { body: this.noteBody().trim(), image: this.noteImage() }
        : undefined;

    this.closed.emit();
    this._submitJoin([leader, ...kids], note);
  }

  private _submitJoin(members: JoinMemberDto[], note?: { body: string; image: File | null }): void {
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

    this.visit.joinQueue(salonId, queueId, slug, { members }, note);
  }

  private _buildKidGroup(serviceId = '') {
    return this._fb.group({ name: ['', Validators.required], serviceId: [serviceId] });
  }
}
