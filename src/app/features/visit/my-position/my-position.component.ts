import { Component, computed, effect, inject, signal, linkedSignal } from '@angular/core';
import { Location, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonVisitService } from '../salon-visit.service';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { PushService } from '../../../core/push/push.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { BackButtonComponent } from '../../../shared/components/back-button/back-button.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { ordinalSuffix } from '../../../core/utils/queue-format';

// Ring geometry — must match the r="125" circle in the template's SVG. Kept
// smaller than the tick-marks' inner edge (~143, per queue-ticks.svg's major
// tick reaching from y=0 to y=20 on a 326x326/163-center viewBox) so there's
// a visible gap between the progress ring and the tick marks, not an overlap.
const RING_RADIUS = 125;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

@Component({
  selector: 'app-my-position',
  templateUrl: './my-position.component.html',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PushPromptComponent,
    FieldErrorComponent,
    BackButtonComponent,
    MediaUrlPipe,
    DatePipe,
  ],
})
export class MyPositionComponent {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _push = inject(PushService);

  protected readonly ringCircumference = RING_CIRCUMFERENCE;

  protected readonly showAddKidsModal = signal(false);

  // Reactive, not snapshot-based — this route can be reused across params
  // (e.g. leaving and rejoining produces a new entryId on the same route),
  // and a one-time ngOnInit never re-runs in that case; only the paramMap
  // actually updates, which is why these must be signals derived from it.
  private readonly _paramMap = toSignal(this._route.paramMap, { requireSync: true });

  protected readonly _slug = computed(() => this._paramMap().get(RouteParam.SLUG) ?? '');
  protected readonly _queueId = computed(() => this._paramMap().get(RouteParam.QUEUE_ID) ?? '');
  protected readonly _entryId = computed(() => this._paramMap().get(RouteParam.ENTRY_ID) ?? '');

  private get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  constructor() {
    effect(() => this.visit.watchQueue(this._queueId()));
  }

  // Pure derivation from visit's signals — no side effect, so linkedSignal
  // (not effect) is the right primitive. previous.value covers the one
  // "leave unchanged" branch: timeline loaded, entry not found yet, but
  // still ours (isMine) — a transient state while the socket catches up,
  // not a real completion.
  protected readonly serviceComplete = linkedSignal<boolean, boolean>({
    source: () => this.visit.timelineLoaded(),
    computation: (timelineLoaded, previous) => {
      if (!timelineLoaded) return false;
      if (this.visit.myEntry(this._entryId())) return false;
      if (!this.visit.isMine(this._entryId())) return true;
      return previous?.value ?? false;
    },
  });

  // Can't leave once any member of this entry is already being served —
  // matches the "Leave queue" button's disabled state.
  protected readonly isBeingServed = computed(() =>
    (this.visit.myEntry(this._entryId())?.members ?? []).some((m) => m.status === 'SERVING'),
  );

  // Progress ring — position-based, not time-based: fuller as the caller
  // gets closer to the front. position is 1-indexed; queue length comes from
  // the full ordered timeline (every entry currently in the queue).
  protected readonly ringProgress = computed(() => {
    const entry = this.visit.myEntry(this._entryId());
    const total = this.visit.timeline().length;
    // position is null for an appointment that hasn't reached the front of
    // the live queue yet (isUpcoming) — nothing to show progress toward.
    if (!entry || total === 0 || entry.position === null) return 0;
    return Math.min(1, Math.max(0, 1 - (entry.position - 1) / total));
  });

  protected readonly ringDashOffset = computed(
    () => RING_CIRCUMFERENCE * (1 - this.ringProgress()),
  );

  protected readonly ordinalSuffix = ordinalSuffix;

  protected readonly addKidsForm = this._fb.group({
    members: this._fb.array<ReturnType<typeof this._buildMemberGroup>>([]),
  });

  protected get membersArray(): FormArray {
    return this.addKidsForm.get('members') as FormArray;
  }

  protected get liveQueueUrl() {
    return RoutePath.visitQueue(this._shellPrefix, this._slug(), this._queueId());
  }

  protected get salonUrl() {
    return RoutePath.visitSalon('', this._slug());
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
    this.visit.addMembers(this._entryId(), rows, () => {
      this.membersArray.clear();
      this.closeAddKids();
    });
  }

  protected leaveQueue(): void {
    const prefix = this._shellPrefix;
    const segments = RoutePath.visitSalon(prefix, this._slug());
    this.visit.leaveQueue(this._entryId(), () => {
      // Guest subscriptions are scoped to the session — unsubscribe when they
      // leave so the device doesn't receive stale push notifications.
      if (prefix === '/g') void this._push.disable();
      this._router.navigate(segments);
    });
  }

  private _firstServiceId(): string {
    const staff = this.visit.staffForQueue(this._queueId());
    return staff ? (this.visit.staffServices(staff)[0]?.id ?? '') : '';
  }

  private _buildMemberGroup(serviceId = '') {
    return this._fb.group({ name: ['', Validators.required], serviceId: [serviceId] });
  }
}
