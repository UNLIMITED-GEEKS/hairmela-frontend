import { Component, inject, input, output, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonVisitService } from '../salon-visit.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { JoinMemberDto } from '../../../api/models/join-member-dto';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';

// Shared join dialog: guest name/phone (guests only) + optional party members
// (kids), submitted as one batch join. Opened from wherever a barber + service
// are already both known (the salon landing page's services-first flow) —
// owns its own form state and the full submit -> /joining navigation, so the
// caller only toggles `open` and reacts to `closed`.
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
  readonly serviceId = input<string | null>(null);

  readonly closed = output<void>();

  protected readonly visit = inject(SalonVisitService);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _fb = inject(FormBuilder);

  protected readonly guestName = signal('');
  protected readonly guestPhone = signal('');
  protected readonly guestNameTouched = signal(false);
  protected readonly guestPhoneTouched = signal(false);

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
    effect(() => {
      if (!this.open()) return;
      const user = this._currentUser.user();
      this.guestName.set(user?.firstName ?? '');
      this.guestPhone.set('');
      this.guestNameTouched.set(false);
      this.guestPhoneTouched.set(false);
      this.kidsArray.clear();
    });
  }

  protected addKid(): void {
    if (this.kidsArray.length >= this.visit.maxPartySize() - 1) return;
    this.kidsArray.push(this._buildKidGroup(this.serviceId() ?? ''));
  }

  protected removeKid(i: number): void {
    this.kidsArray.removeAt(i);
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

    const leader: JoinMemberDto = {
      memberName: leaderName,
      phone,
      serviceId: this.serviceId() ?? undefined,
    };
    const kids = (this.kidsArray.value as { name: string; serviceId: string }[])
      .filter((k) => k.name?.trim())
      .map((k): JoinMemberDto => ({ memberName: k.name.trim(), serviceId: k.serviceId || undefined }));

    this.closed.emit();
    this._submitJoin([leader, ...kids]);
  }

  private _submitJoin(members: JoinMemberDto[]): void {
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
    const joiningUrl = prefix
      ? [prefix, 's', slug, 'q', queueId, 'joining']
      : ['s', slug, 'q', queueId, 'joining'];
    this._router.navigate(joiningUrl);

    this.visit.joinQueue(salonId, queueId, slug, { members });
  }

  private _buildKidGroup(serviceId = '') {
    return this._fb.group({ name: ['', Validators.required], serviceId: [serviceId] });
  }
}
