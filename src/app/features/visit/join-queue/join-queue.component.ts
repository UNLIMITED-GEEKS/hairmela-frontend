import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonVisitService } from '../salon-visit.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { GuestStore } from '../../../core/guest/guest-store';
import { JoinMemberDto } from '../../../api/models/join-member-dto';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';

@Component({
  selector: 'app-join-queue',
  templateUrl: './join-queue.component.html',
  imports: [RouterLink, ReactiveFormsModule, FieldErrorComponent],
})
export class JoinQueueComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _guestStore = inject(GuestStore);
  private readonly _fb = inject(FormBuilder);

  protected readonly selectedServiceId = signal<string | null>(null);
  // The join dialog. Both auth and guest see it; guests additionally fill name/phone.
  protected readonly showJoinDialog = signal(false);
  protected readonly guestName = signal('');
  protected readonly guestPhone = signal('');
  protected readonly guestNameTouched = signal(false);
  protected readonly guestPhoneTouched = signal(false);

  // Optional party members (kids) added at join time — one entry for the whole party.
  protected readonly kidsForm = this._fb.group({
    members: this._fb.array<ReturnType<typeof this._buildKidGroup>>([]),
  });

  private get _slug(): string {
    return this._route.snapshot.paramMap.get('slug') ?? '';
  }

  private get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  protected get queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
  }

  protected get myQueuesUrl(): string {
    return this._shellPrefix ? `${this._shellPrefix}/queues` : '/queues';
  }

  protected alreadyInQueue(): boolean {
    return this.visit.waitingEntries().some((e) => this.visit.isMine(e.entryId));
  }

  protected readonly selectedStaff = computed(() =>
    this.visit.staffForQueue(this.queueId),
  );

  // Frozen salon can't accept walk-ins (backend rejects the join) — pre-block
  // the join button and dialog so the user sees why, not a silent failure.
  protected readonly frozen = computed(() => this.visit.salonData()?.isFrozen ?? false);

  /** Guest = no signed-in user; the dialog then collects name + phone. */
  protected get isGuest(): boolean {
    return !this._currentUser.user();
  }

  protected get kidsArray(): FormArray {
    return this.kidsForm.get('members') as FormArray;
  }

  ngOnInit(): void {
    this.visit.watchQueue(this.queueId);
  }

  protected selectService(serviceId: string): void {
    this.selectedServiceId.set(serviceId);
  }

  // "Join queue" opens the dialog for everyone — the place to add party members
  // now (anyone added later goes to the back of the line as a separate slot).
  protected openJoinDialog(): void {
    if (this.frozen()) return;
    const user = this._currentUser.user();
    if (user) this.guestName.set(user.firstName);
    this.showJoinDialog.set(true);
  }

  protected closeJoinDialog(): void {
    this.showJoinDialog.set(false);
  }

  protected addKid(): void {
    if (this.kidsArray.length >= this.visit.maxPartySize() - 1) return;
    this.kidsArray.push(this._buildKidGroup(this._firstServiceId()));
  }

  protected removeKid(i: number): void {
    this.kidsArray.removeAt(i);
  }

  protected confirmJoin(): void {
    // Block BEFORE navigation — knowable failures stay on the form, no bounce
    if (this.frozen() || this.alreadyInQueue()) return;

    const leaderName = this.isGuest ? this.guestName().trim() : (this._currentUser.user()?.firstName ?? '');
    const phone = this.isGuest ? this.guestPhone().trim() : undefined;
    if (this.isGuest && (!leaderName || !phone)) return;
    if (!leaderName) return;

    const leader: JoinMemberDto = { memberName: leaderName, phone, serviceId: this.selectedServiceId() ?? undefined };
    const kids = (this.kidsArray.value as { name: string; serviceId: string }[])
      .filter((k) => k.name?.trim())
      .map((k): JoinMemberDto => ({ memberName: k.name.trim(), serviceId: k.serviceId || undefined }));

    this.showJoinDialog.set(false);
    this._submitJoin([leader, ...kids]);
  }

  private _submitJoin(members: JoinMemberDto[]): void {
    const salon = this.visit.salon();
    const queueId = this.queueId;
    const slug = this._slug;
    const prefix = this._shellPrefix;
    if (!salon || !queueId) return;
    // Belt-and-suspenders: a join is already in flight (pendingJoin is set) means
    // the dialog is closed and the component is navigating away — drop any re-entrant call.
    if (this.visit.pendingJoin() !== null) return;

    // Navigate to /joining FIRST (navigation-is-feedback).
    // The JoiningQueueComponent reads visit.pendingJoin() and routes to position or back.
    this.visit.pendingJoin.set({ status: 'pending' });
    const joiningUrl = prefix
      ? [prefix, 's', slug, 'q', queueId, 'joining']
      : ['s', slug, 'q', queueId, 'joining'];
    this._router.navigate(joiningUrl);

    // Fire the request — result is delivered via visit.pendingJoin, not a callback.
    this.visit.joinQueue(salon.id, queueId, slug, { members });
  }

  private _firstServiceId(): string {
    const staff = this.selectedStaff();
    return staff ? (this.visit.staffServices(staff)[0]?.id ?? '') : '';
  }

  private _buildKidGroup(serviceId = '') {
    return this._fb.group({ name: ['', Validators.required], serviceId: [serviceId] });
  }
}
