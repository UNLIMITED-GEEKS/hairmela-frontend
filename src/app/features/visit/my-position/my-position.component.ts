import { Component, OnInit, inject, signal, linkedSignal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonVisitService } from '../salon-visit.service';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { PushService } from '../../../core/push/push.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-my-position',
  templateUrl: './my-position.component.html',
  imports: [ReactiveFormsModule, RouterLink, PushPromptComponent, FieldErrorComponent],
})
export class MyPositionComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _push = inject(PushService);

  protected readonly showAddKidsModal = signal(false);

  // Pure derivation from visit's signals — no side effect, so linkedSignal
  // (not effect) is the right primitive. previous.value covers the one
  // "leave unchanged" branch: timeline loaded, entry not found yet, but
  // still ours (isMine) — a transient state while the socket catches up,
  // not a real completion.
  protected readonly serviceComplete = linkedSignal<boolean, boolean>({
    source: () => this.visit.timelineLoaded(),
    computation: (timelineLoaded, previous) => {
      if (!timelineLoaded) return false;
      if (this.visit.myEntry(this._entryId)) return false;
      if (!this.visit.isMine(this._entryId)) return true;
      return previous?.value ?? false;
    },
  });

  protected readonly addKidsForm = this._fb.group({
    members: this._fb.array<ReturnType<typeof this._buildMemberGroup>>([]),
  });

  protected get membersArray(): FormArray {
    return this.addKidsForm.get('members') as FormArray;
  }

  protected get _slug(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SLUG) ?? '';
  }

  protected get _queueId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.QUEUE_ID) ?? '';
  }

  protected get _entryId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.ENTRY_ID) ?? '';
  }

  private get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  ngOnInit(): void {
    this.visit.watchQueue(this._queueId);
  }

  protected get liveQueueUrl() {
    return RoutePath.visitQueue(this._shellPrefix, this._slug, this._queueId);
  }

  protected get salonUrl() {
    return RoutePath.visitSalon('', this._slug);
  }

  protected openAddKids(): void {
    this.showAddKidsModal.set(true);
    if (this.membersArray.length === 0) {
      this.membersArray.push(this._buildMemberGroup(this._firstServiceId()));
    }
  }

  protected closeAddKids(): void {
    this.showAddKidsModal.set(false);
  }

  protected addMember(): void {
    if (this.membersArray.length >= this.visit.maxPartySize() - 1) return;
    this.membersArray.push(this._buildMemberGroup(this._firstServiceId()));
  }

  protected removeMember(i: number): void {
    this.membersArray.removeAt(i);
    if (this.membersArray.length === 0) this.showAddKidsModal.set(false);
  }

  protected submitKids(): void {
    const rows = this.membersArray.value as { name: string; serviceId: string }[];
    this.visit.addMembers(this._entryId, rows, () => {
      this.membersArray.clear();
      this.closeAddKids();
    });
  }

  protected leaveQueue(): void {
    const prefix = this._shellPrefix;
    const segments = RoutePath.visitSalon(prefix, this._slug);
    this.visit.leaveQueue(this._entryId, () => {
      // Guest subscriptions are scoped to the session — unsubscribe when they
      // leave so the device doesn't receive stale push notifications.
      if (prefix === '/g') void this._push.disable();
      this._router.navigate(segments);
    });
  }

  private _firstServiceId(): string {
    const staff = this.visit.staffForQueue(this._queueId);
    return staff ? (this.visit.staffServices(staff)[0]?.id ?? '') : '';
  }

  private _buildMemberGroup(serviceId = '') {
    return this._fb.group({ name: ['', Validators.required], serviceId: [serviceId] });
  }
}
