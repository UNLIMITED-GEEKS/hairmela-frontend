import { Injectable, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, filter, map } from 'rxjs';
import { Router } from '@angular/router';
import { ApiConfiguration } from '../../api/api-configuration';
import { QueueSocketService } from '../../core/socket/queue-socket.service';
import { ServerClockService } from '../../core/clock/server-clock.service';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { ActiveQueuesService } from '../queues/auth-queues/active-queues.service';
import { GuestStore } from '../../core/guest/guest-store';
import { ActiveEntryStore, isAppointmentEntry } from '../../core/queue/active-entry.store';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../core/toast/toast.service';
import { CacheRegistry, Clearable } from '../../core/caching/cache-registry/cache-registry.service';
import { ErrorCodes } from '../../core/errors/error-codes';
import { isApiError } from '../../core/errors/api-error.types';
import { TimelineEntryDto } from '../../core/socket/socket.types';
import { FavoritesService } from '../../core/favorites/favorites.service';
import {
  WaitContext,
  computeLiveWaitMinutes,
  computeMemberWaitMinutes,
  effectiveSinceSnapshotMs,
  formatWait as formatWaitShared,
  servingBookedMinutesFor,
  servingElapsedMsFor,
} from '../../core/queue/wait-time';
import { SalonPublicDto } from '../../api/models/salon-public-dto';
import { SalonPublicStaffDto } from '../../api/models/salon-public-staff-dto';
import { Service } from '../../api/models/service';
import { Queue } from '../../api/models/queue';
import { JoinQueueDto } from '../../api/models/join-queue-dto';
import { publicSalonsControllerFindBySlug } from '../../api/fn/salons/public-salons-controller-find-by-slug';
import { publicServicesControllerFindBySalon } from '../../api/fn/services/public-services-controller-find-by-salon';
import { publicQueueControllerGetTimeline } from '../../api/fn/queues/public-queue-controller-get-timeline';
import { publicQueueControllerGetQueue } from '../../api/fn/queues/public-queue-controller-get-queue';
import { walkInControllerJoinQueue } from '../../api/fn/queues/walk-in-controller-join-queue';
import { walkInControllerLeaveQueue } from '../../api/fn/queues/walk-in-controller-leave-queue';
import { walkInControllerCancelMyMember } from '../../api/fn/queues/walk-in-controller-cancel-my-member';
import { customerMemberServicesControllerAdd } from '../../api/fn/queues/customer-member-services-controller-add';
import { availabilityControllerGetSlots } from '../../api/fn/schedules/availability-controller-get-slots';
import { bookingControllerBookAppointment } from '../../api/fn/queues/booking-controller-book-appointment';
import { AvailableSlotDto } from '../../api/models/available-slot-dto';
import { BookAppointmentDto } from '../../api/models/book-appointment-dto';
import { SocketPredictService } from '../../core/caching/socket-predict/socket-predict.service';
import { myEntriesControllerGetMyEntries } from '../../api/fn/queues/my-entries-controller-get-my-entries';
import { guestEntriesControllerGetGuestEntries } from '../../api/fn/queues/guest-entries-controller-get-guest-entries';
import { entryStatusControllerGetEntry } from '../../api/fn/queues/entry-status-controller-get-entry';
import { EntryStatusResponseDto } from '../../api/models/entry-status-response-dto';
import { RoutePath, RouteQueryParam } from '../../core/routing/route-paths';
import { CommentsService, PostCommentInput } from '../comments/comments.service';

import { ActiveEntry } from '../../core/queue/active-entry.store';
export type { ActiveEntry };

export interface AddMemberRow {
  name: string;
  serviceId: string;
}

export type PendingJoin =
  | { status: 'pending' }
  | { status: 'joined'; entryId: string; queueId: string; slug: string; shellPrefix: string }
  | { status: 'failed'; reason: 'closed' | 'party-too-large' | 'generic' };

export interface BookMemberRow {
  name: string;
  serviceId: string;
  phone?: string;
  email?: string;
}

export type BookingResult =
  | { status: 'booked' }
  | { status: 'failed'; reason: 'slot-taken' | 'slot-in-past' | 'generic' };

// The public timeline redacts memberName for every entry, including the
// caller's own (see ActiveEntry.memberNames' doc comment). Captured from the
// names WE SENT in the request — not from the response's `entry.members`,
// which the generated type claims is always populated but isn't on the wire
// for walk-in joins (the backend returns the entry row before it creates the
// member records, so `.members` is undefined at runtime despite the model —
// confirmed live, not just in the types). We already know every name; no
// server round-trip needed to learn it back.
//
// Position-keyed only because member ids don't exist yet at this point.
// ActiveEntryStore.bindMemberNames re-keys these to real member ids on the
// first timeline frame — positions are NOT safe to hold long-term, since a
// member removed from the party disappears from the timeline array and shifts
// everyone behind them down an index.
function captureMemberNames(names: string[]): Record<number, string> {
  const byPosition: Record<number, string> = {};
  names.forEach((name, i) => (byPosition[i] = name));
  return byPosition;
}

// How long a cached salon payload stays usable. Short on purpose: this is the
// public-facing salon page, so opening hours, staff list and services need to
// go stale quickly. Long enough to cover browsing back and forth between a few
// salons, which is the whole point of the cache.
//
// FIXME: this TTL knowingly serves stale AVAILABILITY, which is the one part
// of the payload that is not merely cosmetic. Within the 5-minute window a
// returning customer can see:
//
//   - salon.staff  — the barber picker (staffList()). A barber marked
//     unavailable, or removed from the salon, still renders and can be tapped.
//     The queue itself is live, so they find out on the next screen — but the
//     bad first impression is ours.
//   - isOpen       — worse, because selectBarber() GATES ON IT (see the
//     `if (!this.salonData()?.isOpen) return false;` check). A salon that
//     closed during the window still lets a customer through the join, and a
//     salon that just OPENED still refuses them for up to 5 minutes.
//   - services/prices — a price edited during the window shows the old value.
//
// Accepted deliberately: the alternative was refetching on every back-nav,
// which is the bug this cache exists to fix. Revisit if customers report
// joining closed salons or picking absent barbers. The targeted fix is not a
// shorter TTL (it trades the bug back) but re-validating just the volatile
// fields on a cache hit — a cheap HEAD/etag or an isOpen+staff-only endpoint —
// while still serving the heavy static payload from cache.
const SALON_TTL_MS = 5 * 60 * 1000;

// Only the STATIC half of a salon visit is cached. Live queue state (timeline,
// queueStatus, activeEntries, socket rooms) is deliberately excluded — it is
// pushed over a socket and would be wrong to restore from a snapshot, showing
// a returning customer stale wait times while the room is no longer watched.
interface CachedSalon {
  readonly salon: SalonPublicDto;
  readonly services: Service[];
  readonly fetchedAt: number;
}

@Injectable({ providedIn: 'root' })
export class SalonVisitService implements Clearable {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _clock = inject(ServerClockService);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _activeQueues = inject(ActiveQueuesService);
  private readonly _guestStore = inject(GuestStore);
  private readonly _activeEntryStore = inject(ActiveEntryStore);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _socketPredict = inject(SocketPredictService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _comments = inject(CommentsService);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _favorites = inject(FavoritesService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private _watchedQueueIds = new Set<string>();
  private _shellPrefix = '';
  private _socketInitialReceived = new Set<string>();
  private _loadedSlug: string | null = null;
  // Keyed by slug. Was a single _loadedSlug slot, which meant only the most
  // recent salon was remembered: A -> B -> A refetched A every time, because
  // B had overwritten the slot.
  private readonly _salonCache = new Map<string, CachedSalon>();
  // The queue currently displayed (position/live-queue page). Because timeline
  // is a single shared signal (see FIXME below), this id is what every async
  // writer checks (`if (this._activeQueueId !== queueId) return;`) so a late
  // push from a queue the user has since navigated away from can't overwrite
  // the one on screen. watchQueue() also uses it to seed timeline from the
  // target queue's cached frame on switch — see the comment there for WHY it
  // seeds instead of blanking (blanking left switched-to queues empty forever).
  //
  // FIXME: this is a patch, not the real fix. The root cause is that `timeline`
  // is one global signal pretending to represent "whatever queue was last
  // viewed", even though the domain has N concurrent queues (dashboard watches
  // several; a caller can be in two barbers' lines at one salon). Because of
  // that, every async writer (the socket subscription in watchQueue() and all
  // three timeline.set() paths in _loadInitialTimeline()) has to defend itself
  // with `if (this._activeQueueId !== queueId) return;` — a guard that's easy
  // to forget at the next write site added — and switching queues has to
  // manually re-seed timeline from a side cache (QueueSocketService.lastTimeline)
  // because a shared signal has no memory of the queue you're returning to.
  // The proper fix is to partition state by queueId (e.g. a
  // Map<queueId, QueueState> exposed via a timelineFor(queueId) signal) so
  // views read their own queue's signal: stale cross-queue pushes become
  // structurally impossible, switch-back is free (each queue keeps its own
  // signal), and _activeQueueId + every guard + the lastTimeline side cache all
  // delete. Deferred: touches myEntry(), waitingEntries(), liveWaitMinutes(),
  // memberWaitMinutes(), _reconcileEntries(), and both viewing components.
  private _activeQueueId: string | null = null;

  readonly salonData = signal<SalonPublicDto | null>(null);
  readonly services = signal<Service[]>([]);
  readonly timeline = signal<TimelineEntryDto[]>([]);
  // timelineLoaded means "there is something to render" — it goes true even
  // when timeline was seeded from a stale cached socket frame (see
  // watchQueue()'s cached-seed branch). timelineConfirmed means "what's on
  // screen is confirmed current for this queue, this visit" — it only goes
  // true at a genuine fetch/socket landing point, and is reset to false on
  // every switch to a queue (including the first). The live-queue page's
  // "getting the latest queue status" banner is simply !timelineConfirmed,
  // which covers both a cold first load (nothing rendered yet) and a
  // re-entry showing a stale replay — both are "we're fetching, hang on".
  readonly timelineConfirmed = signal(false);
  readonly queueStatus = signal<Queue['status'] | null>(null);
  // A customer can hold several entries in one queue (added-while-waiting creates
  // a new one at the back). Tracked as an array; views address a single entry by id.
  readonly activeEntries = signal<ActiveEntry[]>([]);
  readonly loading = signal(true);
  readonly servicesLoading = signal(true);
  readonly timelineLoaded = signal(false);
  readonly joining = signal(false);
  readonly leaving = signal(false);
  readonly addingKids = signal(false);
  // memberIds currently mid-removal (cancelMember) — my-position disables
  // that row's button and shows a spinner while set, same lock-during-flight
  // idea as the console's isLocked(), just scoped to this one action.
  readonly cancellingMemberIds = signal<ReadonlySet<string>>(new Set());
  readonly calledVisible = signal(false);
  readonly booking = signal(false);
  readonly bookingResult = signal<BookingResult | null>(null);
  // Signal-based result for the navigation-is-feedback join flow.
  // Set to `pending` before navigating to /joining; resolved to `joined` or `failed`
  // by joinQueue(); the JoiningQueueComponent reads it and routes accordingly.
  // Writable by design — the JoiningQueueComponent clears it after handling.
  readonly pendingJoin = signal<PendingJoin | null>(null);
  // Which tab (about/services/staffs) the salon landing page last showed —
  // persisted here (not local component state) so navigating away and back
  // within the same salon visit restores it instead of resetting to 'about'.
  readonly landingTab = signal<'about' | 'services' | 'staffs'>('about');
  // The service selected on the Services tab's barber-drilldown — persisted so
  // going back and forth between barbers (e.g. comparing wait times for the
  // same service) doesn't force re-picking the service each time.
  readonly selectedServiceId = signal<string | null>(null);

  readonly salon = computed(() => this.salonData()?.salon ?? null);
  readonly staffList = computed(() => this.salonData()?.staff ?? []);

  // Whether this salon wants service prices shown to customers. settings is
  // an untyped blob on the wire (backend doesn't declare its shape in
  // Swagger) — same bracket-index-and-cast pattern as salon-settings.component.ts.
  readonly showPrice = computed(() => {
    const settings = this.salon()?.settings as Record<string, unknown> | undefined;
    return (settings?.['showPrice'] as boolean) ?? true;
  });

  /**
   * Whether this salon takes walk-ins at all.
   *
   * When off it is appointments only: the live-queue page's primary button
   * becomes "Book" and opens the appointment dialog instead of the join-queue
   * one, since there is no walk-in queue to join.
   */
  readonly allowsWalkIns = computed(() => {
    const settings = this.salon()?.settings as Record<string, unknown> | undefined;
    return (settings?.['allowWalkIns'] as boolean) ?? true;
  });

  /**
   * Whether this salon requires a booking fee before joining or booking.
   *
   * Read from the already-loaded salon settings rather than the quote
   * endpoint, because the dialogs need it BEFORE the customer acts — it is
   * what decides whether their button says "Next" (a payment step follows) or
   * submits straight away. The quote itself is only fetched once they commit.
   *
   * The quote's own `enforced` flag stays authoritative for whether payment is
   * actually required; this is the cheap up-front hint.
   */
  readonly enforcesBookingFee = computed(() => {
    const settings = this.salon()?.settings as Record<string, unknown> | undefined;
    return (settings?.['enforceBookingFee'] as boolean) ?? false;
  });

  /** Where customers should send a booking fee. Null when unconfigured. */
  readonly paymentDetails = computed(() => this.salon()?.paymentDetails ?? null);

  /** The live timeline entry for a specific entryId (the position page's entry). */
  myEntry(entryId: string): TimelineEntryDto | null {
    return this.timeline().find((e) => e.entryId === entryId) ?? null;
  }

  // Per-entry status, direct from the backend rather than inferred from
  // timeline presence. The live timeline excludes a WALK_IN/APPOINTMENT once
  // it's no longer WAITING/SERVING, AND excludes an APPOINTMENT scheduled for
  // a later salon-local day — so "absent from the timeline" has three causes
  // (served/no-show/cancelled, or just not-today-yet) that myEntry() alone
  // can't tell apart. position/estimatedWaitMinutes come from the same engine
  // the timeline uses, so they never disagree with what's shown elsewhere.
  getEntryStatus(queueId: string, entryId: string): Observable<EntryStatusResponseDto> {
    return entryStatusControllerGetEntry(this._http, this._apiConfig.rootUrl, {
      queueId,
      entryId,
    }).pipe(map((res) => res.body));
  }

  /** True if any of the user's own entries belong to this queue's timeline. */
  isMine(entryId: string): boolean {
    return this.activeEntries().some((e) => e.entryId === entryId);
  }

  readonly waitingEntries = computed(() =>
    this.timeline().filter((e) =>
      e.members.some((m) => m.status === 'WAITING' || m.status === 'SERVING'),
    ),
  );

  readonly maxPartySize = computed(() => {
    const settings = this.salon()?.settings as { maxPartySize?: number } | undefined;
    return settings?.maxPartySize ?? 5;
  });

  // The public timeline blanks memberName for every entry (see
  // ActiveEntry.memberNames' doc comment) — including this one, the caller's
  // own. Overlays the name captured at join/book time, matched by memberId,
  // whenever the server sent a blank.
  //
  // By memberId, not position: a member can be REMOVED from a party, and a
  // removed member vanishes from the timeline's members array, shifting
  // everyone behind them down an index — positional matching would then paste
  // names onto the wrong people with no error. Ids are bound from the first
  // timeline frame (ActiveEntryStore.bindMemberNames, driven by
  // _reconcileEntries), which lands well before any removal is possible.
  //
  // A genuinely-blank name from the server (not just redaction) is
  // indistinguishable from redaction here, but the fallback is the same
  // either way — worst case an already-empty field stays empty. Leaves a real
  // (non-blank) memberName alone, so this is inert if the backend contract
  // ever changes to stop redacting the caller's own entry.
  partyMembers(entryId: string): TimelineEntryDto['members'] {
    return this.withStoredNames(entryId, this.myEntry(entryId)?.members ?? []);
  }

  /**
   * Applies the stored-name overlay to any members array, whatever its source.
   *
   * Split out from partyMembers() because the position page also renders
   * members from the per-entry status fetch, which is the ONLY source for an
   * appointment scheduled beyond today (absent from the live timeline, so
   * partyMembers() is empty for it). That endpoint returns real names rather
   * than redacted ones, in which case this is inert — but routing both
   * sources through the same overlay means neither can drift.
   */
  withStoredNames(
    entryId: string,
    members: TimelineEntryDto['members'],
  ): TimelineEntryDto['members'] {
    return members.map((m) =>
      m.memberName
        ? m
        : {
            ...m,
            memberName: this._activeEntryStore.getMemberName(entryId, m.memberId) ?? m.memberName,
          },
    );
  }

  private readonly _servingEntry = computed(
    () => this.timeline().find((e) => e.members.some((m) => m.status === 'SERVING')) ?? null,
  );

  // Anchors wait-time math to WHEN THE LAST FRAME LANDED, not to servedAt —
  // see core/queue/wait-time.ts's header comment for why: estimatedWaitMinutes
  // already has elapsed-since-servedAt subtracted by the backend, so
  // subtracting it again here would double-count. _snapshotAt is set at every
  // genuine fresh-timeline landing point (see the timeline.set() call sites
  // below and in _loadInitialTimeline); it deliberately does NOT move on
  // watchQueue()'s cache-seed/reset writes, which carry no new server data.
  // Written only at genuine fresh-frame landing points via _markSnapshot();
  // never mutated during a computed's evaluation. The overrun freeze is
  // derived (see effectiveSinceSnapshotMs), not latched, so _waitContext
  // stays a pure function of signals + this value.
  private _snapshotAt = signal<number | null>(null);

  private _markSnapshot(): void {
    this._snapshotAt.set(this._clock.now());
  }

  private readonly _waitContext = computed((): WaitContext => {
    this._clock.tick();
    const timeline = this.timeline();
    const servingEntry = this._servingEntry();
    const nowMs = this._clock.now();

    const servingElapsedMs = servingEntry ? servingElapsedMsFor(servingEntry, nowMs) : null;
    const servingBookedMinutes = servingEntry ? servingBookedMinutesFor(servingEntry) : null;

    const sinceSnapshotMs = effectiveSinceSnapshotMs({
      nowMs,
      snapshotAtMs: this._snapshotAt(),
      servingElapsedMs,
      servingBookedMinutes,
    });

    return { timeline, sinceSnapshotMs, servingElapsedMs, servingBookedMinutes };
  });

  readonly liveWaitMinutes = computed(
    (): Map<string, number> => computeLiveWaitMinutes(this._waitContext()),
  );

  readonly memberWaitMinutes = computed(
    (): Map<string, number> => computeMemberWaitMinutes(this._waitContext()),
  );

  init(slug: string, shellPrefix = ''): void {
    this._shellPrefix = shellPrefix;
    this._clock.start();
    // Re-entering the same salon (e.g. position page -> back -> position page)
    // needs no reset: salonData/services are still correct and watchQueue()
    // already no-ops for queues it's still watching. Only a genuine salon
    // change (different slug) tears down and refetches.
    if (this._loadedSlug === slug && this.salonData()) return;
    this._loadedSlug = slug;
    this._resetForNewSalon();
    const storedEntries = this._activeEntryStore.getAll();

    // Serve the static salon payload from cache when it's still fresh, so
    // hopping between salons doesn't refetch the page you just looked at.
    // Live queue state was cleared by _resetForNewSalon() above and is NOT
    // restored here — _resumeQueueWatch re-subscribes for real, exactly as it
    // does on a cold load.
    const cached = this._salonCache.get(slug);
    if (cached && Date.now() - cached.fetchedAt < SALON_TTL_MS) {
      this.salonData.set(cached.salon);
      this.services.set(cached.services);
      this.loading.set(false);
      this.servicesLoading.set(false);
      this._resumeQueueWatch(cached.salon, storedEntries);
      return;
    }
    // Expired — drop it so a failed refetch can't leave a stale entry behind.
    if (cached) this._salonCache.delete(slug);

    this._loadSalon(slug, storedEntries);
  }

  destroy(): void {
    this._clock.stop();
  }

  // CacheRegistry hook — logout must not leave one user's salon payloads
  // readable by the next session on the same device. _loadedSlug is reset too,
  // so the next init() genuinely refetches rather than short-circuiting on
  // salonData that is about to be cleared.
  clear(): void {
    this._salonCache.clear();
    this._loadedSlug = null;
  }

  private _resetForNewSalon(): void {
    for (const queueId of this._watchedQueueIds) {
      this._socket.unwatchQueue(queueId);
    }
    this._watchedQueueIds.clear();
    this._socketInitialReceived.clear();
    this._activeQueueId = null;
    this.salonData.set(null);
    this.services.set([]);
    this.timeline.set([]);
    this.queueStatus.set(null);
    this.activeEntries.set([]);
    this.loading.set(true);
    // Was omitted here, so switching salons left this false from the previous
    // salon while services was cleared to [] — the Services tab rendered
    // "no services" instead of a loading state until the refetch landed.
    this.servicesLoading.set(true);
    this.timelineLoaded.set(false);
    this.timelineConfirmed.set(false);
    this.joining.set(false);
    this.leaving.set(false);
    this.addingKids.set(false);
    this.calledVisible.set(false);
    this.booking.set(false);
    this.bookingResult.set(null);
    this.pendingJoin.set(null);
    this.landingTab.set('about');
    this.selectedServiceId.set(null);
  }

  watchQueue(queueId: string): void {
    if (this._activeQueueId !== queueId) {
      // Switching which queue is displayed. Don't blank timeline to [] and
      // wait — the socket's per-queue stream is a ReplaySubject(1), and an
      // already-attached subscription won't re-emit its cached frame on its
      // own, so blanking here leaves the queue looking empty until the next
      // server push (which may never come while the user is looking). Instead
      // seed timeline synchronously from this queue's last cached frame if we
      // already have one; the live subscription below (for a not-yet-watched
      // queue) or a fresh server push then keeps it current.
      this._activeQueueId = queueId;
      const cached = this._socket.lastTimeline(queueId);
      // Neither branch is confirmed-current — the cached branch is a replay
      // from some earlier point this session; the empty branch has nothing
      // yet. Real confirmation only happens at the socket subscription below
      // or _loadInitialTimeline's landing points.
      this.timelineConfirmed.set(false);
      // Reset the per-visit "socket already delivered" race guard so the
      // fresh timeline fetch below (which _loadInitialTimeline gates on this
      // flag) is allowed to land on re-entry. Without this, a queue watched
      // earlier this session still has the flag set from that past visit, and
      // the re-entry fetch would be skipped — leaving a session-old replay on
      // screen with the banner unable to clear. A genuinely fresher live push
      // arriving during this visit's load race still re-sets the flag and wins
      // (its handler runs and re-adds the id), same as on a first visit.
      this._socketInitialReceived.delete(queueId);
      if (cached) {
        this.timeline.set(cached);
        this.timelineLoaded.set(true);
      } else {
        this.timeline.set([]);
        this.timelineLoaded.set(false);
      }

      // Refresh status + timeline whenever this queue becomes the displayed
      // one — including re-entry to a queue watched earlier this session
      // (navigate away -> back). Without a fetch here, re-entry hits the
      // _watchedQueueIds early-return below and nothing re-confirms the
      // banner except a brand-new server push, which "may never come while
      // the user is looking" (see the seed comment above). Placed inside this
      // branch (not unconditionally) so a redundant same-queue watchQueue()
      // call — e.g. _loadSalon's entry-recovery watch followed by the
      // component effect's watch for the same queueId — doesn't double-fetch.
      this._socket.connect();
      this._loadQueueStatus(queueId);
      this._loadInitialTimeline(queueId);
    }

    if (this._watchedQueueIds.has(queueId)) return;
    this._watchedQueueIds.add(queueId);

    this._socket.watchQueue(queueId);

    this._socket
      .queueTimeline$(queueId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((entries) => {
        if (this._activeQueueId !== queueId) return;
        const isFirstMessage = !this._socketInitialReceived.has(queueId);
        this._socketInitialReceived.add(queueId);
        this._reconcileEntries(queueId, entries, isFirstMessage);
        this.timeline.set(entries);
        this._markSnapshot();
        this.timelineLoaded.set(true);
        this.timelineConfirmed.set(true);
      });

    this._socket
      .serverTime$(queueId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((serverTime) => this._clock.sync(serverTime));
  }

  // Returns true when the caller should open the join dialog for this staff
  // member (called from the live queue page's Join button) — false whenever
  // selectBarber() already handled the click itself (redirected to register,
  // or navigated to an existing position). Every branch below except the
  // final one still navigates directly; only "no existing entry, salon open"
  // hands control back to the caller.
  selectBarber(staff: SalonPublicStaffDto, slug: string): boolean {
    if (!staff.queueId) return false;
    const isGuest = !!this._shellPrefix;
    if (!isGuest && !this._currentUser.user() && !this._guestStore.hasToken()) {
      const returnUrl = RoutePath.visitSalon('', slug).join('/');
      this._router.navigate(RoutePath.register(), {
        queryParams: { [RouteQueryParam.RETURN_URL]: returnUrl },
      });
      return false;
    }
    // Only an existing WALK-IN blocks a fresh join. An appointment is a
    // reservation for a later slot — holding one says nothing about whether
    // the customer can also stand in the line right now, and they often want
    // both (walk in today, keep next week's booking). Redirecting on any
    // stored entry made a booking silently un-joinable for that barber until
    // the appointment was served or cancelled.
    //
    const myWalkIns = this._activeEntryStore
      .getAllForQueue(staff.queueId!)
      .filter((e) => !isAppointmentEntry(e));
    if (myWalkIns.length > 0) {
      // Already in this queue — open the position page for the (earliest) entry,
      // even if the salon is now closed (they may still be waiting).
      this._router.navigate(
        RoutePath.visitPosition(this._shellPrefix, slug, staff.queueId!, myWalkIns[0].entryId),
      );
      return false;
    }
    // No existing entry — a fresh join is only allowed while the salon is open.
    if (!this.salonData()?.isOpen) return false;
    return true;
  }

  // note is a one-shot message (+ optional image) attached at intake — a
  // separate POST fired right after the entry exists, not part of the join
  // payload itself (the join endpoint has no field for it). Never blocks or
  // fails the join: the user is already in the queue by the time it fires,
  // so a failure here is swallowed (see CommentsService.post's doc — same
  // Cloudinary-first pattern as every other comment/media post). Visible
  // later via the "View notes" accordion on My Position, not shown here.
  joinQueue(
    salonId: string,
    queueId: string,
    salonSlug: string,
    body: JoinQueueDto,
    note?: PostCommentInput,
  ): void {
    walkInControllerJoinQueue(this._http, this._apiConfig.rootUrl, { salonId, queueId, body })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const entryId = res.body.entry.id;
          const guestToken = res.body.guestToken ?? null;
          const entry: ActiveEntry = {
            queueId,
            entryId,
            salonId,
            salonSlug,
            type: 'WALK_IN',
            pendingMemberNames: captureMemberNames(body.members.map((m) => m.memberName)),
          };
          this.activeEntries.update((list) => [
            ...list.filter((e) => e.entryId !== entryId),
            entry,
          ]);
          this._activeEntryStore.save(entry);
          this._loadInitialTimeline(queueId);
          if (guestToken) this._guestStore.setToken(guestToken);
          this.pendingJoin.set({
            status: 'joined',
            entryId,
            queueId,
            slug: salonSlug,
            shellPrefix: this._shellPrefix,
          });

          if (note && (note.body.trim() || note.image)) {
            this._comments
              .post(queueId, entryId, note)
              .pipe(takeUntilDestroyed(this._destroyRef))
              .subscribe({
                error: () => this._toast.info("Joined, but your note couldn't be sent."),
              });
          }
        },
        error: (err) => {
          const apiBody = (err as { error?: unknown })?.error;
          if (isApiError(apiBody) && apiBody.code === ErrorCodes.QUEUE_NOT_OPEN) {
            this.queueStatus.set('CLOSED');
            this.pendingJoin.set({ status: 'failed', reason: 'closed' });
          } else if (isApiError(apiBody) && apiBody.code === ErrorCodes.PARTY_TOO_LARGE) {
            this.pendingJoin.set({ status: 'failed', reason: 'party-too-large' });
          } else {
            this.pendingJoin.set({ status: 'failed', reason: 'generic' });
          }
        },
      });
  }

  // Bookable slots for one staff member across an inclusive salon-local date
  // range (a calendar month, from the booking dialog's month-grid picker) —
  // public, no auth (a guest can browse availability before deciding to
  // register/log in and actually book, same as browsing the queue itself).
  // Deliberately NOT cached anywhere (unlike AppointmentsCalendarService's
  // booked-appointment history) — live bookable-slot availability must
  // always be current; only the fetch itself is batched per-month instead
  // of per-day, not the response.
  getAvailabilityRange(salonId: string, staffId: string, from: string, to: string) {
    return availabilityControllerGetSlots(this._http, this._apiConfig.rootUrl, {
      salonId,
      staffId,
      from,
      to,
    }).pipe(map((res): AvailableSlotDto[] => res.body));
  }

  // Books an appointment for the signed-in customer. Unlike joinQueue, there
  // is no guest path here — BookingController requires JwtAuthGuard, so this
  // is only ever called from behind the `CurrentUserStore.user()` gate on the
  // live-queue page's "Book an appointment" section. On success, the new
  // entry is saved the same way joinQueue saves one, so My Queues' recovery
  // fetch (my-entries) picks it up immediately without a manual refetch.
  bookAppointment(
    salonId: string,
    queueId: string,
    salonSlug: string,
    date: string,
    startTime: string,
    members: BookMemberRow[],
    notes?: string,
    onSuccess?: () => void,
    // Comments-thread note, same one-shot pattern as joinQueue's `note` param
    // — distinct from `notes` above, which is BookAppointmentDto's own
    // booking-level free text field, not a comment. Fired after the entry
    // exists; never blocks or fails the booking.
    note?: PostCommentInput,
    // Proof the booking fee was paid, for salons that enforce one. Trailing
    // and optional so existing callers are unchanged.
    receiptVerificationId?: string,
  ): void {
    if (this.booking()) return;
    this.booking.set(true);
    const body: BookAppointmentDto = {
      date,
      startTime,
      members: members.map((m) => ({
        memberName: m.name.trim(),
        serviceId: m.serviceId,
        phone: m.phone,
        email: m.email,
      })),
      notes,
      receiptVerificationId,
    };

    bookingControllerBookAppointment(this._http, this._apiConfig.rootUrl, {
      salonId,
      queueId,
      body,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const bookedEntry = res.body.entry;
          const guestToken = res.body.guestToken;
          const entry: ActiveEntry = {
            queueId,
            entryId: bookedEntry.id,
            salonId,
            salonSlug,
            pendingMemberNames: captureMemberNames(body.members.map((m) => m.memberName)),
            type: 'APPOINTMENT',
            // Kept so _reconcileEntries can tell "scheduled for a later day,
            // so not in today's timeline" from "finished, drop it".
            scheduledAt: bookedEntry.scheduledAt,
          };
          this.activeEntries.update((list) => [
            ...list.filter((e) => e.entryId !== entry.entryId),
            entry,
          ]);
          this._activeEntryStore.save(entry);
          if (guestToken) this._guestStore.setToken(guestToken);
          this.booking.set(false);
          this.bookingResult.set({ status: 'booked' });
          // My Queues is fed by ActiveQueuesService's own cached list, gated
          // by a 30s TTL only invalidated by the socket noticing an entry get
          // called — booking a NEW entry is neither, so without this the page
          // silently shows stale data (the entry missing) until the TTL
          // happens to expire. onSuccess (book-appointment-dialog's navigate)
          // fires AFTER this refresh() call, not before, so My Queues' first
          // fetch on mount lands after the new entry is already visible in
          // the DB — no incomplete-list flash, no need for a second corrective
          // fetch. There's nothing local to update, My Queues reads its own
          // separate signal.
          if (this._currentUser.user()) this._activeQueues.refresh();
          this._toast.success('Appointment booked.');
          onSuccess?.();

          if (note && (note.body.trim() || note.image)) {
            this._comments
              .post(queueId, entry.entryId, note)
              .pipe(takeUntilDestroyed(this._destroyRef))
              .subscribe({
                error: () => this._toast.info("Booked, but your note couldn't be sent."),
              });
          }
        },
        error: (err: unknown) => {
          this.booking.set(false);
          const apiBody = (err as { error?: unknown })?.error;
          if (
            isApiError(apiBody) &&
            (apiBody.code === ErrorCodes.SLOT_NOT_AVAILABLE ||
              apiBody.code === ErrorCodes.SLOT_ALREADY_BOOKED)
          ) {
            this.bookingResult.set({ status: 'failed', reason: 'slot-taken' });
            this._toast.error('That slot was just taken — pick another.');
          } else if (isApiError(apiBody) && apiBody.code === ErrorCodes.SLOT_IN_PAST) {
            this.bookingResult.set({ status: 'failed', reason: 'slot-in-past' });
            this._toast.error('That time has already passed — pick another slot.');
          } else {
            this.bookingResult.set({ status: 'failed', reason: 'generic' });
            this._toast.error('Failed to book appointment.');
          }
        },
      });
  }

  leaveQueue(entryId: string, onSuccess: () => void): void {
    const entry = this._activeEntryStore.getByEntryId(entryId);
    if (!entry) return;
    this._confirmDialog
      .open({
        title: 'Leave queue?',
        message: 'Your spot will be lost and you will need to rejoin.',
        confirmLabel: 'Leave',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        // Extra side effects before timeline predict
        this._activeEntryStore.remove(entry.entryId);
        this.activeEntries.update((list) => list.filter((e) => e.entryId !== entry.entryId));
        // My Queues (ActiveQueuesService) is a separate cached signal, not
        // touched by anything above — without this it keeps showing the
        // just-left entry until its own 30s TTL/socket fallback catches up.
        // Same gap bookAppointment() had; fired here (optimistic-confirm),
        // not in the HTTP request's own success below, to match this
        // method's predict-now-revert-on-error shape.
        this._activeQueues.refresh();
        this._toast.success('You have left the queue.');
        onSuccess();

        this._socketPredict.run({
          signal: this.timeline,
          apply: (t) => t.filter((e) => e.entryId !== entry.entryId),
          request: () =>
            walkInControllerLeaveQueue(this._http, this._apiConfig.rootUrl, {
              salonId: entry.salonId,
              queueId: entry.queueId,
              entryId: entry.entryId,
            }),
          onError: () => {
            // Revert: re-add the active entry + refetch timeline
            this._activeEntryStore.save(entry);
            this.activeEntries.update((list) => [...list, entry]);
            this._loadInitialTimeline(entry.queueId);
            this._toast.error('Failed to leave queue — your spot has been restored.');
          },
          destroyRef: this._destroyRef,
        });
      });
  }

  // Removes ONE member from the caller's own party without cancelling the
  // whole entry (backend: sets that member to CANCELLED). Never offered for a
  // SERVING member — my-position only wires the button to WAITING rows,
  // matching the backend's own rule.
  //
  // No optimistic paint: the confirming socket frame (queue.updated, emitted
  // after the backend's transaction commits — including any auto-close if
  // this was the last active member) is what actually updates `timeline`.
  // This just locks the row (cancellingMemberIds → spinner/disabled) and
  // fires the request; on error, refetch re-asserts truth.
  //
  // If this was the last WAITING/SERVING member, the backend auto-closes the
  // whole entry — once that's confirmed, this ALSO removes the ActiveEntry
  // from storage exactly like leaveQueue does, since there's nothing left of
  // it to hold a position for.
  //
  // `members` lets the caller supply the party when the live timeline can't:
  // an appointment scheduled beyond today isn't in any timeline frame, so
  // myEntry() is null for it and the last-active check below would silently
  // read false — leaving a stored entry behind after the backend auto-closed
  // it, which then shows as a phantom booking in My Queues and blocks
  // re-booking via selectBarber()'s duplicate check. Falls back to the
  // timeline when omitted.
  cancelMember(
    entryId: string,
    memberId: string,
    onSuccess: () => void,
    members?: TimelineEntryDto['members'],
  ): void {
    const entry = this._activeEntryStore.getByEntryId(entryId);
    const salon = this.salon();
    if (!entry || !salon) return;
    this._confirmDialog
      .open({
        title: 'Remove this person?',
        message: 'They will be removed from your party.',
        confirmLabel: 'Remove',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        const partyMembers = members ?? this.myEntry(entryId)?.members ?? [];
        const wasLastActive =
          partyMembers.filter((m) => m.status === 'WAITING' || m.status === 'SERVING').length === 1;

        this.cancellingMemberIds.update((s) => new Set([...s, memberId]));
        walkInControllerCancelMyMember(this._http, this._apiConfig.rootUrl, {
          salonId: salon.id,
          queueId: entry.queueId,
          entryId,
          memberId,
        })
          .pipe(takeUntilDestroyed(this._destroyRef))
          .subscribe({
            next: () => {
              this.cancellingMemberIds.update((s) => {
                const next = new Set(s);
                next.delete(memberId);
                return next;
              });
              if (wasLastActive) {
                this._activeEntryStore.remove(entryId);
                this.activeEntries.update((list) => list.filter((e) => e.entryId !== entryId));
              }
              onSuccess();
            },
            error: () => {
              this.cancellingMemberIds.update((s) => {
                const next = new Set(s);
                next.delete(memberId);
                return next;
              });
              this._loadInitialTimeline(entry.queueId);
              this._toast.error('Failed to remove — please try again.');
            },
          });
      });
  }

  // "Add someone while waiting" is just another join: it creates a NEW entry at
  // the back of the line (the leader of the new slot is the first added person).
  // The interceptor attaches the guest token, so there is no guest/auth fork.
  addMembers(sourceEntryId: string, members: AddMemberRow[], onSuccess: () => void): void {
    const entry = this._activeEntryStore.getByEntryId(sourceEntryId);
    const salon = this.salon();
    if (!entry || !salon || this.addingKids()) return;
    const valid = members.filter((k) => k.name?.trim());
    if (valid.length === 0) {
      onSuccess();
      return;
    }
    this.addingKids.set(true);
    const body: JoinQueueDto = {
      members: valid.map((k) => ({
        memberName: k.name.trim(),
        serviceId: k.serviceId || undefined,
      })),
    };

    walkInControllerJoinQueue(this._http, this._apiConfig.rootUrl, {
      salonId: salon.id,
      queueId: entry.queueId,
      body,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const newEntry: ActiveEntry = {
            queueId: entry.queueId,
            entryId: res.body.entry.id,
            salonId: salon.id,
            salonSlug: entry.salonSlug,
            // "Add someone while waiting" creates a fresh WALK-IN at the back
            // of the line, whatever the entry it was launched from.
            type: 'WALK_IN',
            pendingMemberNames: captureMemberNames(body.members.map((m) => m.memberName)),
          };
          if (res.body.guestToken) this._guestStore.setToken(res.body.guestToken);
          this._activeEntryStore.save(newEntry);
          this.activeEntries.update((list) => [
            ...list.filter((e) => e.entryId !== newEntry.entryId),
            newEntry,
          ]);
          this.addingKids.set(false);
          this._loadInitialTimeline(entry.queueId);
          this._toast.success('Added to the back of the line.');
          onSuccess();
        },
        error: (err: unknown) => {
          this.addingKids.set(false);
          const apiBody = (err as { error?: unknown })?.error;
          if (isApiError(apiBody) && apiBody.code === ErrorCodes.PARTY_TOO_LARGE) {
            this._toast.error('Party size exceeds the maximum allowed.');
          }
        },
      });
  }

  addCustomerMemberServices(
    queueId: string,
    entryId: string,
    memberId: string,
    serviceIds: string[],
    onSuccess?: () => void,
    onError?: (err: unknown) => void,
  ): void {
    customerMemberServicesControllerAdd(this._http, this._apiConfig.rootUrl, {
      queueId,
      entryId,
      memberId,
      body: { serviceIds },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this._toast.success(
            serviceIds.length === 1 ? 'Service added.' : 'Services added.',
          );
          this._loadInitialTimeline(queueId);
          onSuccess?.();
        },
        error: (err: unknown) => {
          onError?.(err);
        },
      });
  }

  staffServices(staff: SalonPublicStaffDto): Service[] {
    return this.services().filter((s) => staff.serviceIds.includes(s.id));
  }

  formatWait(minutes: number): string {
    return formatWaitShared(minutes);
  }

  liveWait(entryId: string): string {
    return this.formatWait(this.liveWaitMinutes().get(entryId) ?? 0);
  }

  memberWait(memberId: string): string {
    return this.formatWait(this.memberWaitMinutes().get(memberId) ?? 0);
  }

  /**
   * Estimated wait for someone joining now — they go behind everyone currently
   * waiting, so they wait until the last entry *finishes*: that entry's own wait
   * plus the duration of its still-pending members.
   */
  backOfLineWait(): string {
    // Exclude isUpcoming appointments — a not-yet-due booking (>10min out on
    // the public view) isn't in the live line, so a fresh joiner doesn't wait
    // behind it. Its liveWait is already 0, but its members' serviceDuration
    // would still get added as lastPending below if it were the max-wait
    // entry, wrongly inflating the joiner's estimate by the booking's length.
    const entries = this.waitingEntries().filter((e) => !e.isUpcoming);
    if (entries.length === 0) return this.formatWait(0);
    const liveWaits = this.liveWaitMinutes();
    const last = entries.reduce((a, b) =>
      (liveWaits.get(b.entryId) ?? 0) >= (liveWaits.get(a.entryId) ?? 0) ? b : a,
    );
    const lastWait = liveWaits.get(last.entryId) ?? 0;
    const lastPending = last.members
      .filter((m) => m.status === 'WAITING' || m.status === 'SERVING')
      .reduce((sum, m) => sum + m.serviceDuration, 0);
    return this.formatWait(lastWait + lastPending);
  }

  staffForQueue(queueId: string): SalonPublicStaffDto | null {
    return this.salonData()?.staff.find((s) => s.queueId === queueId) ?? null;
  }

  // Re-attaches the socket watch for an entry the user already holds in this
  // salon. Shared by the cached and freshly-fetched paths so a cache hit
  // resubscribes identically — the socket room is live state and is never
  // restored from the cache itself.
  private _resumeQueueWatch(salon: SalonPublicDto, storedEntries: ActiveEntry[]): void {
    for (const stored of storedEntries) {
      const matchesStaff = salon.staff.some((s) => s.queueId === stored.queueId);
      if (matchesStaff) {
        this.watchQueue(stored.queueId);
        break;
      }
    }
  }

  private _loadSalon(slug: string, storedEntries: ActiveEntry[]): void {
    publicSalonsControllerFindBySlug(this._http, this._apiConfig.rootUrl, { slug })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const body = res.body;
          // Only paint if this salon is still the one on screen. A slow
          // response for A must not repaint over B — and _resumeQueueWatch
          // below must not attach A's socket room while B is displayed.
          // The services fetch still runs either way, so an abandoned salon
          // finishes populating its own cache entry for the next visit.
          const isCurrent = this._loadedSlug === slug;
          if (isCurrent) {
            this.salonData.set(body);
            this.loading.set(false);
          }
          publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, {
            salonId: body.salon.id,
          })
            .pipe(takeUntilDestroyed(this._destroyRef))
            .subscribe({
              next: (svc) => {
                // Cache regardless of whether this salon is still on screen —
                // the entry is keyed by ITS OWN slug, so a late response still
                // caches correctly for the salon it belongs to.
                this._salonCache.set(slug, {
                  salon: body,
                  services: svc.body,
                  fetchedAt: Date.now(),
                });
                // ...but only paint if the user hasn't since switched salons.
                // Same guard idiom as _loadInitialTimeline's _activeQueueId
                // check: without it, a slow response for salon A overwrote the
                // services list while salon B was already displayed.
                if (this._loadedSlug !== slug) return;
                this.services.set(svc.body);
                this.servicesLoading.set(false);
              },
              error: () => {
                if (this._loadedSlug !== slug) return;
                this.servicesLoading.set(false);
              },
            });
          if (isCurrent) this._resumeQueueWatch(body, storedEntries);
        },
        error: () => {
          if (this._loadedSlug !== slug) return;
          this.loading.set(false);
          this.servicesLoading.set(false);
          this._toast.error('Salon not found');
        },
      });
  }

  private _loadQueueStatus(queueId: string): void {
    publicQueueControllerGetQueue(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this.queueStatus.set(res.body.status) });
  }

  private _loadInitialTimeline(queueId: string): void {
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          // Skip if the socket already delivered a fresher frame during this
          // visit's load race — the socket is the authoritative source. The
          // _socketInitialReceived Set is populated in watchQueue()'s socket
          // subscription and reset per-visit in the seed branch, so on
          // re-entry (no new push yet) this fetch is allowed through to
          // refresh the stale replay and clear the banner.
          if (this._socketInitialReceived.has(queueId)) return;
          // Skip if the caller has since switched to a different queue — this
          // response would otherwise overwrite the new queue's timeline with
          // stale data from the one that's no longer displayed.
          if (this._activeQueueId !== queueId) return;
          const { timeline: entries, serverTime } = res.body;
          this._clock.sync(serverTime);
          // One mark covers all three timeline.set() branches below — they
          // all derive from this same response's entries/serverTime, so one
          // call here can't be missed the way three separately-placed calls
          // could on a future edit to this method.
          this._markSnapshot();
          const stored = this._activeEntryStore.getAllForQueue(queueId);
          if (stored.length > 0) {
            this._reconcileEntries(queueId, entries, true);
            this.timeline.set(entries);
            this.timelineLoaded.set(true);
            this.timelineConfirmed.set(true);
            return;
          }
          // No stored entries — recover all of the caller's entries for this queue.
          // my-entries (auth) / guest-entries (guest) both carry the guest token via
          // the interceptor now, so guest-entries no longer needs the manual client.
          const recover$ = this._currentUser.user()
            ? myEntriesControllerGetMyEntries(this._http, this._apiConfig.rootUrl).pipe(
                map((r) => r.body),
              )
            : this._guestStore.hasToken()
              ? guestEntriesControllerGetGuestEntries(this._http, this._apiConfig.rootUrl).pipe(
                  map((r) => r.body),
                )
              : null;
          if (!recover$) {
            this.timeline.set(entries);
            this.timelineLoaded.set(true);
            this.timelineConfirmed.set(true);
            return;
          }
          recover$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
            next: (myEntries) => {
              if (this._activeQueueId !== queueId) return;
              const salon = this.salon();
              const recovered = myEntries
                .filter((e) => e.queueId === queueId)
                .map(
                  (e): ActiveEntry => ({
                    queueId,
                    entryId: e.id,
                    salonId: salon?.id ?? '',
                    salonSlug: salon?.slug ?? '',
                    type: e.type,
                    scheduledAt: e.scheduledAt,
                  }),
                );
              for (const entry of recovered) this._activeEntryStore.save(entry);
              if (recovered.length > 0) {
                this.activeEntries.update((list) => {
                  const ids = new Set(recovered.map((e) => e.entryId));
                  return [...list.filter((e) => !ids.has(e.entryId)), ...recovered];
                });
              }
              this.timeline.set(entries);
              this.timelineLoaded.set(true);
              this.timelineConfirmed.set(true);
            },
            error: () => {
              if (this._activeQueueId !== queueId) return;
              this.timeline.set(entries);
              this.timelineLoaded.set(true);
              this.timelineConfirmed.set(true);
            },
          });
        },
      });
  }

  /**
   * True for an appointment booked for a day after today, which the live
   * timeline deliberately excludes (it's bounded to the end of the salon-local
   * day) — so its absence from a frame says nothing about whether it ended.
   *
   * Compared in the BROWSER's timezone, not the salon's, which the client
   * doesn't have. That's a deliberate approximation: the only cost of getting
   * it wrong near a day boundary in a distant timezone is keeping a stored
   * entry one frame longer than needed, or dropping one a few hours early —
   * and the position page reads the authoritative status from
   * getEntryStatus() regardless, so nothing user-visible depends on this
   * being exact. It exists only to stop a definitely-future booking being
   * deleted from local storage.
   */
  private _isScheduledBeyondToday(entry: ActiveEntry): boolean {
    if (!entry.scheduledAt) return false;
    const scheduled = new Date(entry.scheduledAt);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    return scheduled.getTime() > endOfToday.getTime();
  }

  /**
   * Reconciles the caller's stored entries for a queue against the live timeline:
   * keeps the ones still present, drops the ones that vanished (served/cancelled),
   * and fires the "you're up" banner when one of the caller's own entries starts
   * being served. Used by both the socket stream and the REST fallback.
   *
   * An entry absent from the frame is dropped as finished UNLESS it's booked
   * beyond today — see _isScheduledBeyondToday.
   */
  private _reconcileEntries(
    queueId: string,
    entries: TimelineEntryDto[],
    isFirstMessage: boolean,
  ): void {
    const stored = this._activeEntryStore.getAllForQueue(queueId);
    const live: ActiveEntry[] = [];
    for (const entry of stored) {
      const timelineEntry = entries.find((e) => e.entryId === entry.entryId);
      if (timelineEntry) {
        // Bind creation-time names (position-keyed, since member ids don't
        // exist yet at join/book time) to real member ids, using this frame's
        // ordering. No-op after the first frame. Done here because positions
        // are only trustworthy until a member is removed from the party, and
        // this runs on every frame — so binding happens immediately, long
        // before a removal could shift them. Re-read afterwards so `live`
        // (which feeds the activeEntries signal) carries the bound copy, not
        // the stale pre-binding one.
        this._activeEntryStore.bindMemberNames(
          entry.entryId,
          timelineEntry.members.map((m) => m.memberId),
        );
        live.push(this._activeEntryStore.getByEntryId(entry.entryId) ?? entry);
        if (!isFirstMessage && timelineEntry.members.some((m) => m.status === 'SERVING')) {
          this.calledVisible.set(true);
          setTimeout(() => this.calledVisible.set(false), 5000);
        }
      } else if (this._isScheduledBeyondToday(entry)) {
        // Absent because it's booked for a later day, not because it ended —
        // the timeline only carries today's entries. Keep it: dropping it
        // here would lose the booking from My Queues and let selectBarber()
        // offer a duplicate for a slot the customer already holds.
        live.push(entry);
      } else {
        this._activeEntryStore.remove(entry.entryId);
      }
    }
    // Merge this queue's live entries into the cross-queue active list.
    this.activeEntries.update((list) => {
      const others = list.filter((e) => e.queueId !== queueId);
      return [...others, ...live];
    });
  }

  /** Public favourites count for a salon by slug. */
  getSalonFavoritesCount(slug: string): Promise<number | null> {
    return this._favorites.getSalonFavoritesCount(slug);
  }

  /** Public favourites count for a staff member by staffId. */
  getStaffFavoritesCount(staffId: string): Promise<number | null> {
    return this._favorites.getStaffFavoritesCount(staffId);
  }
}
