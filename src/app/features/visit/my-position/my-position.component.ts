import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Location, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonVisitService } from '../salon-visit.service';
import { EntryStatusResponseDto } from '../../../api/models/entry-status-response-dto';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { PushService } from '../../../core/push/push.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { BackButtonComponent } from '../../../shared/components/back-button/back-button.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { CommentsThreadComponent } from '../../comments/comments-thread/comments-thread.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { ordinalSuffix } from '../../../core/utils/queue-format';
import { AddToCalendarComponent } from '../../../shared/components/add-to-calendar/add-to-calendar.component';

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
    InlineSpinnerComponent,
    AccordionComponent,
    CommentsThreadComponent,
    MediaUrlPipe,
    DatePipe,
    AddToCalendarComponent,
  ],
})
export class MyPositionComponent {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _push = inject(PushService);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly ringCircumference = RING_CIRCUMFERENCE;

  protected readonly showAddKidsModal = signal(false);
  protected readonly notesOpen = signal(false);
  private readonly _commentsThread = viewChild(CommentsThreadComponent);

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

  // Direct per-entry fetch — the source of truth for status/type/scheduledAt.
  // NOT derived from timeline presence: the live timeline excludes an entry
  // once it's no longer WAITING/SERVING, AND excludes an APPOINTMENT
  // scheduled for a later salon-local day, so "absent from timeline" has
  // three different causes (served/no-show/cancelled, or just not-today-yet)
  // that can't be told apart from timeline data alone. position/wait still
  // come from myEntry()/timeline when the entry IS present there (walk-ins,
  // same-day appointments) — that's the live, second-by-second-ticking
  // source; this fetch is only for the one signal the timeline can't give us.
  protected readonly entryStatus = signal<EntryStatusResponseDto | null>(null);

  // Number the customer calls from the notes composer: the barber's own
  // phone when they've set one, otherwise the salon's main line — a salon
  // that can route the call is strictly better than no button at all. Null
  // only when neither exists, which hides the button.
  protected readonly callPhone = computed(
    () => this.entryStatus()?.staff?.phone ?? this.visit.salon()?.phone ?? null,
  );

  // Whether this entry is currently in the live timeline. A computed, not a
  // raw myEntry() read, because a computed only notifies when its OUTPUT
  // changes: the timeline emits a fresh array (and fresh entry objects) on
  // every socket frame, so depending on the object itself would retrigger on
  // every push. As a boolean it changes only on the actual enters/leaves
  // transition.
  private readonly _isInTimeline = computed(() => !!this.visit.myEntry(this._entryId()));

  constructor() {
    effect(() => this.visit.watchQueue(this._queueId()));

    // Fetches on route entry, and again when the entry LEAVES the live
    // timeline — that's how a SERVED/NO_SHOW/CANCELLED becomes visible here,
    // since the backend drops the entry from the timeline at the same moment.
    //
    // Only the leaving direction refetches. `timeline` starts empty, so the
    // first frame landing always flips presence false -> true; refetching on
    // that would fire a second, redundant request for the same entry on every
    // single page load, against a rate-limited endpoint.
    //
    // The tracked reads are exactly the three below; everything with a side
    // effect is inside untracked(). Critically, entryStatus is WRITTEN here
    // but never READ in tracked scope — reading it would make the effect
    // depend on its own output (fetch -> write -> re-run -> fetch), which is
    // exactly the loop that tripped the backend's rate limiter in an earlier
    // revision of this file.
    let wasInTimeline = false;
    effect(() => {
      const queueId = this._queueId();
      const entryId = this._entryId();
      const isInTimeline = this._isInTimeline();

      untracked(() => {
        const justLeftTimeline = wasInTimeline && !isInTimeline;
        wasInTimeline = isInTimeline;

        if (!queueId || !entryId) {
          this.entryStatus.set(null);
          return;
        }
        // A different entry means a different fetch is needed regardless of
        // presence — clear first so the page can't show the previous entry's
        // status while the new one loads.
        const isNewEntry = this.entryStatus()?.entryId !== entryId;
        if (isNewEntry) this.entryStatus.set(null);

        // Skip the redundant false -> true refetch described above; the
        // initial fetch for this entry has already been issued.
        if (!isNewEntry && !justLeftTimeline) return;

        this._fetchEntryStatus(queueId, entryId);
      });
    });
  }

  // Guards against out-of-order responses: navigating entry A -> B while A's
  // request is still in flight would otherwise let A's response overwrite B's.
  private _statusFetchId = 0;

  private _fetchEntryStatus(queueId: string, entryId: string): void {
    const fetchId = ++this._statusFetchId;
    this.visit
      .getEntryStatus(queueId, entryId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          if (fetchId !== this._statusFetchId) return;
          this.entryStatus.set(res);
        },
        // Leave the previous value in place on a transient failure rather
        // than nulling it out — the next transition or revisit corrects it,
        // and dropping a known-good status would flash the loading state for
        // no reason.
        error: () => {},
      });
  }

  protected readonly serviceComplete = computed(() => {
    const status = this.entryStatus()?.status;
    return status === 'SERVED' || status === 'NO_SHOW' || status === 'CANCELLED';
  });

  // Can't leave once already being served — matches the "Leave queue"
  // button's disabled state.
  protected readonly isBeingServed = computed(() => this.entryStatus()?.status === 'SERVING');

  // Party members, preferring the live timeline (ticks with each frame) and
  // falling back to the per-entry fetch. The fallback isn't an edge case: an
  // appointment scheduled beyond today is absent from the timeline entirely,
  // so the fetch is the ONLY source of its members — without this the party
  // list renders empty for every future booking, even though the response
  // carries all of them.
  protected readonly partyMembers = computed(() => {
    const fromTimeline = this.visit.partyMembers(this._entryId());
    if (fromTimeline.length > 0) return fromTimeline;
    const fetched = this.entryStatus()?.members ?? [];
    return this.visit.withStoredNames(this._entryId(), fetched);
  });

  // An APPOINTMENT always shows its scheduled time, never a queue position —
  // its `position` is where it sits in the ordering once its slot arrives,
  // not "walk up now". A 9pm booking can read position 1 at noon.
  protected readonly isAppointment = computed(() => this.entryStatus()?.type === 'APPOINTMENT');

  // A WALK_IN's position comes from the live timeline while it's in there
  // (ticks with each frame); the fetched entry is the fallback, and the two
  // come from the same engine so they can't disagree.
  protected readonly queuePosition = computed(
    () => this.visit.myEntry(this._entryId())?.position ?? this.entryStatus()?.position ?? null,
  );

  // Date included only when the appointment isn't today — "Today at 9:00 PM"
  // is noise on the page you land on right after booking, but a bare time is
  // ambiguous for something days out. Uses the salon's own scheduledAt string
  // rather than recomputing from a local clock.
  // ── Add to calendar (appointments only) ──────────────────────────────────
  // A walk-in has no scheduled time, so the template gates on isAppointment()
  // as well as on a non-null scheduledAt.
  protected readonly calendarStart = computed(() => this.entryStatus()?.scheduledAt ?? null);

  protected readonly calendarTitle = computed(
    () => `Appointment at ${this.visit.salon()?.name ?? 'the salon'}`,
  );

  protected readonly calendarLocation = computed(() => {
    const a = this.visit.salon()?.address;
    return a ? [a.street, a.city, a.state].filter(Boolean).join(', ') : '';
  });

  protected readonly calendarDetails = computed(() =>
    this.partyMembers()
      .map((m) => m.serviceName)
      .filter((n): n is string => !!n)
      .join(', '),
  );

  protected readonly scheduledLabel = computed(() => {
    const scheduledAt = this.entryStatus()?.scheduledAt;
    if (!scheduledAt) return null;
    const scheduled = new Date(scheduledAt);
    const now = new Date();
    const sameDay =
      scheduled.getFullYear() === now.getFullYear() &&
      scheduled.getMonth() === now.getMonth() &&
      scheduled.getDate() === now.getDate();
    return { date: scheduled, sameDay };
  });

  // Progress ring — position-based, not time-based: fuller as the caller
  // gets closer to the front. position is 1-indexed; queue length comes from
  // the full ordered timeline.
  //
  // Empty for an appointment: its position is where it lands once its slot
  // arrives, so a 9pm booking would paint a nearly-full ring at noon. The
  // scheduled time is the whole story there, and the bare tick ring reads as
  // "not started" rather than falsely "almost up".
  protected readonly ringProgress = computed(() => {
    if (this.isAppointment()) return 0;
    const entry = this.visit.myEntry(this._entryId());
    const total = this.visit.timeline().length;
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

  // Expand = refetch (no live updates — spec is manual refresh only), so every
  // open gets fresh data, not just the first. viewChild is only populated
  // once the accordion's content has rendered at least once; on the very
  // first open in the same tick the child may not exist yet, so this is
  // called from the accordion's (openChange) rather than relying on the
  // signal alone.
  protected onNotesOpenChange(open: boolean): void {
    this.notesOpen.set(open);
    if (open) this._commentsThread()?.refresh();
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

  // Unlike leaveQueue(), no navigation on success: removing one non-leader
  // member just updates this same page's party list. If it happened to be
  // the LAST member (auto-closing the whole entry), the existing
  // serviceComplete/myEntry() handling already covers "entry no longer
  // exists" — no separate redirect needed here.
  // Passes the rendered party so the service's last-active check works for a
  // future appointment too, where the live timeline has no entry to read.
  //
  // Refetches on success for the same reason: a future appointment's party
  // list comes from entryStatus, and nothing else would refresh it — the
  // timeline never carries this entry, so no frame arrives to repaint the
  // removed member away. For a walk-in the timeline repaints it anyway and
  // this is just a confirming read.
  protected cancelMember(memberId: string): void {
    this.visit.cancelMember(
      this._entryId(),
      memberId,
      () => this._fetchEntryStatus(this._queueId(), this._entryId()),
      this.partyMembers(),
    );
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
