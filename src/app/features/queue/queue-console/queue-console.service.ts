import { Injectable, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, catchError, concatMap, filter, of, retry, switchMap, tap } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueSocketService } from '../../../core/socket/queue-socket.service';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../core/toast/toast.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { TimelineEntryDto } from '../../../core/socket/socket.types';
import { Queue } from '../../../api/models/queue';
import { ExtendMemberDto } from '../../../api/models/extend-member-dto';
import { publicQueueControllerGetTimeline } from '../../../api/fn/queues/public-queue-controller-get-timeline';
import { publicQueueControllerGetQueue } from '../../../api/fn/queues/public-queue-controller-get-queue';
import { queueManagementControllerSetStatus } from '../../../api/fn/queues/queue-management-controller-set-status';
import { queueManagementControllerCallNext } from '../../../api/fn/queues/queue-management-controller-call-next';
import { queueManagementControllerServeMember } from '../../../api/fn/queues/queue-management-controller-serve-member';
import { queueManagementControllerCompleteAllMembers } from '../../../api/fn/queues/queue-management-controller-complete-all-members';
import { queueManagementControllerCompleteMember } from '../../../api/fn/queues/queue-management-controller-complete-member';
import { queueManagementControllerExtendMember } from '../../../api/fn/queues/queue-management-controller-extend-member';
import { queueManagementControllerMarkNoShow } from '../../../api/fn/queues/queue-management-controller-mark-no-show';
import { queueManagementControllerCancelEntry } from '../../../api/fn/queues/queue-management-controller-cancel-entry';
import { walkInControllerStaffAddToQueue } from '../../../api/fn/queues/walk-in-controller-staff-add-to-queue';
import { staffBookingControllerStaffBookAppointment } from '../../../api/fn/queues/staff-booking-controller-staff-book-appointment';
import { staffServicesControllerGetStaffServices } from '../../../api/fn/services/staff-services-controller-get-staff-services';
import { StaffService } from '../../../api/models/staff-service';
import { BookAppointmentDto } from '../../../api/models/book-appointment-dto';
import { SocketPredictService } from '../../../core/caching/socket-predict/socket-predict.service';

// Ring geometry — matches the same r="125" circle convention used by the
// customer-facing my-position ring (see that component for the tick-mark
// spacing rationale).
const RING_RADIUS = 125;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

@Injectable()
export class QueueConsoleService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _socketPredict = inject(SocketPredictService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;
  // Tracks whether a socket frame has arrived for the current queue session.
  // The REST GET in init() is a fallback for a slow socket; if a socket frame
  // lands first, a later REST response must not stomp it.
  private _socketInitialReceived = false;
  // The console is scoped to a single queue; stored in init() so the shared
  // _runLocked() helper can refetch on error without every action passing it.
  private _activeQueueId = '';
  // The entry id callNext() last targeted, while callNextWaiting() is true —
  // read by the frame subscriber in init() to know which entry's confirming
  // frame should clear the spinner. Can't be re-derived from
  // waitingEntries()[0]: the optimistic paint in callNext() immediately
  // promotes this entry out of "waiting", so waitingEntries()[0] would
  // already point at a different entry by the time a frame arrives.
  private readonly _callNextTargetEntryId = signal<string | null>(null);
  // Serial queue for every _runLocked mutation's actual HTTP dispatch on this
  // queue — concatMap runs each request only after the previous one has
  // settled, so the backend always processes this queue's actions in the
  // order the barber issued them. See _runLocked's comment for why this
  // exists instead of a per-action-pair guard. Subscribed once, for the
  // service's lifetime (providedIn the queue console, so this dies with it).
  private readonly _actionQueue$ = new Subject<() => Observable<unknown>>();
  // True while _actionQueue$ has a request actually in flight on the network
  // (dispatched, not yet settled) — read by callNext() at click time to
  // decide whether it's safe to paint the new client's name immediately.
  // Plain field, not a signal: written/read synchronously within the same
  // click handler, never by a computed().
  private _actionInFlight = false;
  private readonly _actionQueueSub = this._actionQueue$
    .pipe(
      concatMap((run) => {
        this._actionInFlight = true;
        return run().pipe(
          catchError(() => of(null)),
          tap(() => (this._actionInFlight = false)),
        );
      }),
      takeUntilDestroyed(this._destroyRef),
    )
    .subscribe();

  readonly queue = signal<Queue | null>(null);
  readonly staffServices = signal<StaffService[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  // Global lock — for actions with no single entry/member target (status change).
  readonly acting = signal(false);

  //. This file is doing too much. QueueConsoleService is now ~730 lines holding: socket lifecycle, REST fallback, the optimistic-overlay engine (_optimisticAdds/_addRealIds/_addBaselineCounts/_pruneConfirmedAdds/_removePendingAdd), the pending-lock engine (_pendingIds/_runLocked), the timer/tick machinery, wait-time computation, and the eight business actions. The overlay+lock machinery is a genuinely reusable, testable unit — it's conceptually the same job SocketPredictService does, just at a higher level. A principal engineer would likely have noticed that the "temp overlay that reconciles against authoritative server state" is a second general primitive hiding inside a feature service, and either extracted it or consciously decided not to. We never had that conversation — it grew there incrementally across a long debugging session. That's the tell: the architecture is locally correct but was arrived at by accretion, not design. It works, but nobody stepped back and asked "what's the actual shape of this."
  // ── Two sources, one view #FIXME ────────────────────────────────────────────────
  // NOTE (possible future extraction): the machinery below — the two-source
  // signals, the merge computed, _pruneConfirmedAdds/_removePendingAdd, and the
  // _pendingIds/_runLocked lock lifecycle — is a general "optimistic overlay
  // reconciled against authoritative socket state" engine, conceptually a
  // higher-level sibling of SocketPredictService. It grew inline here while
  // debugging and has NOT had a deliberate extract-vs-keep pass. If a second
  // feature needs the same pattern, extract it into core/caching before
  // copy-pasting. Kept inline for now (single consumer — YAGNI).
  //
  // _serverTimeline is the ONLY writer of authoritative state: socket frames
  // and the REST fallback set it wholesale, no reconciliation, no temp logic.
  // The socket is the source of truth (no client-vs-server timestamp compare,
  // which mixed two clocks and caused the prod flash-back bug).
  //
  // _optimisticAdds is a separate overlay of client-painted temp entries that
  // don't exist server-side yet, giving the barber instant feedback. It never
  // mixes into _serverTimeline — the two sources are merged only in the
  // `timeline` computed below, which drops a temp the instant its confirmed
  // real entry appears in the server timeline. Because that's a computed, the
  // swap is synchronous with either source changing: no window where both a
  // temp and its real entry render (double), and none where neither does
  // (vanish), regardless of whether the frame or the HTTP response lands first.
  private readonly _serverTimeline = signal<TimelineEntryDto[]>([]);
  private readonly _optimisticAdds = signal<TimelineEntryDto[]>([]);
  // temp entry id -> real entry id once the add's POST returns it (null while
  // in flight). A temp drops from the view once its real id is in the server
  // timeline; while the real id is unknown, the temp always shows.
  private readonly _addRealIds = signal<ReadonlyMap<string, string | null>>(new Map());
  // FIXME: heuristic, not a rigorous fix. temp entry id -> server entry count
  // at the moment the add started. While the real id is still unknown (POST
  // in flight), a frame that grows the server count past this baseline is
  // treated as carrying this add's entry even before the id can be confirmed —
  // closing the "both temp and real render" double-entry window when the
  // frame beats the HTTP response.
  //
  // This was removed once (reasoning: the backend fixed the read-after-write
  // race that used to make queue.updated omit the new entry, so this seemed
  // no longer needed) and reinstated after the double-entry bug reproduced
  // again in testing WITH the backend fix in place — so the frame-vs-response
  // ordering race is real on its own, independent of that backend bug.
  //
  // Known false-positive: can't distinguish this add's frame from a DIFFERENT
  // concurrent add growing the count first, which would hide the wrong temp
  // for one frame. Correct fix is a backend-echoed idempotency key so the
  // frontend can match the frame's new entry to this add with certainty
  // instead of guessing from count growth.
  private readonly _addBaselineCounts = new Map<string, number>();

  readonly timeline = computed<TimelineEntryDto[]>(() => {
    const server = this._serverTimeline();
    const serverIds = new Set(server.map((e) => e.entryId));
    const realIds = this._addRealIds();
    const visibleTemps = this._optimisticAdds().filter((temp) => {
      const realId = realIds.get(temp.entryId);
      if (realId) return !serverIds.has(realId);
      // Real id not resolved yet — fall back to the count heuristic so the
      // temp doesn't double up with a frame that already carries it.
      const baseline = this._addBaselineCounts.get(temp.entryId);
      if (baseline !== undefined && server.length > baseline) return false;
      return true;
    });
    return [...server, ...visibleTemps];
  });

  // Once a temp's real entry has landed in _serverTimeline, it's permanently
  // hidden by the `timeline` computed above — this just reclaims the now-dead
  // overlay/map/lock state so it doesn't grow across many adds in a session.
  // Called by _setServerTimeline (every frame/REST write) and by an add's own
  // onSuccess (fast-network path). Plain imperative cleanup — deliberately NOT
  // an effect, since it writes the very signals an effect would be reading.
  private _pruneConfirmedAdds(): void {
    const serverIds = new Set(this._serverTimeline().map((e) => e.entryId));
    const realIds = this._addRealIds();
    const confirmed = this._optimisticAdds().filter((temp) => {
      const realId = realIds.get(temp.entryId);
      return !!realId && serverIds.has(realId);
    });
    confirmed.forEach((temp) => this._removePendingAdd(temp.entryId));
  }

  // Removes one temp add from the overlay + real-id map + pending lock.
  // Used both for confirmed adds (see above) and for a failed/deduped add
  // that never got, or no longer needs, a place in the overlay.
  private _removePendingAdd(tempEntryId: string): void {
    const temp = this._optimisticAdds().find((e) => e.entryId === tempEntryId);
    this._optimisticAdds.update((t) => t.filter((e) => e.entryId !== tempEntryId));
    this._addRealIds.update((m) => {
      const next = new Map(m);
      next.delete(tempEntryId);
      return next;
    });
    this._addBaselineCounts.delete(tempEntryId);
    const memberIds = temp ? temp.members.map((m) => m.memberId) : [];
    this._clearPending(tempEntryId, ...memberIds);
  }

  // Writes the authoritative server timeline, then prunes any temp add the new
  // frame has now confirmed. The single funnel for every server write (socket
  // frame, REST fallback, _runLocked's paint, _refetchTimeline) — so pruning
  // happens exactly where new truth lands, imperatively (NOT in an effect,
  // which cannot write the signals prune touches).
  private _setServerTimeline(entries: TimelineEntryDto[]): void {
    this._serverTimeline.set(entries);
    this._pruneConfirmedAdds();
  }

  // ── Paint + lock ─────────────────────────────────────────────────────────
  // An entry/member id is "pending" from the moment the barber acts on it
  // until the action's own HTTP response settles (the response is the one
  // signal guaranteed to fire exactly once; a "wait for next frame" rule can
  // hang forever on a quiet queue). While pending the row's buttons disable
  // and a spinner shows — the barber never acts on unconfirmed data.
  private readonly _pendingIds = signal<ReadonlySet<string>>(new Set());

  isPending(id: string | undefined | null): boolean {
    return !!id && this._pendingIds().has(id);
  }

  private _beginPending(...ids: string[]): void {
    this._pendingIds.update((s) => new Set([...s, ...ids]));
  }

  private _clearPending(...ids: string[]): void {
    this._pendingIds.update((s) => {
      const next = new Set(s);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  // Marks one member SERVED and, mirroring the backend's own auto-promotion,
  // marks the next WAITING member in the same entry (array order — the
  // backend never reorders or skips) as SERVING locally too. Without this,
  // completing the only SERVING member in a multi-member party makes
  // servingMember() briefly return nothing until the confirming frame
  // arrives with the real promotion — a flash in the "Current Client" circle
  // even though the outcome was never actually in doubt.
  private _completeAndPromoteNext(entry: TimelineEntryDto, memberId: string): TimelineEntryDto {
    const completedIndex = entry.members.findIndex((m) => m.memberId === memberId);
    const nextIndex = entry.members.findIndex(
      (m, i) => i > completedIndex && m.status === 'WAITING',
    );
    return {
      ...entry,
      members: entry.members.map((m, i) => {
        if (m.memberId === memberId) return { ...m, status: 'SERVED' as const };
        if (i === nextIndex) {
          return { ...m, status: 'SERVING' as const, servedAt: new Date().toISOString() };
        }
        return m;
      }),
    };
  }

  // Runs one optimistic, socket-confirmed mutation on an EXISTING entry with
  // the full paint+lock lifecycle: lock the target ids, paint optimistically
  // onto the server timeline immediately, then dispatch the HTTP request —
  // and unlock when it settles — on error a re-fetch re-asserts authoritative
  // state. (Adds don't use this — they paint to the _optimisticAdds overlay
  // instead.)
  //
  // The request is dispatched via _actionQueue$ rather than fired immediately:
  // two mutating actions on this queue (e.g. End Session then Call Next,
  // fired back-to-back by the barber) are independent HTTP calls that can
  // reach the backend out of order or overlapping, and the backend enforces
  // ordering invariants across them (only one SERVING entry at a time) — so
  // firing Call Next's request before End Session's has actually committed
  // 409s and reverts the optimistic paint. Routing every request through the
  // one serial queue guarantees the backend always processes this queue's
  // actions in the same order the barber issued them, without the UI ever
  // waiting: the optimistic paint + lock above still happen synchronously, so
  // the barber sees instant feedback regardless of when the request actually
  // goes out. This replaces an earlier, narrower attempt that only
  // special-cased "block Call Next while End Session is pending" — that made
  // Call Next unusable for the whole window instead of just reordering the
  // network calls.
  private _runLocked(config: {
    ids: string[];
    apply: (t: TimelineEntryDto[]) => TimelineEntryDto[];
    request: () => Observable<unknown>;
    onError?: (err: unknown) => void;
  }): void {
    this._beginPending(...config.ids);
    this._serverTimeline.update((t) => config.apply(t));
    this._actionQueue$.next(() =>
      config.request().pipe(
        tap({
          error: (err) => {
            this._refetchTimeline(this._activeQueueId);
            config.onError?.(err);
          },
        }),
        catchError(() => of(null)),
        tap(() => this._clearPending(...config.ids)),
      ),
    );
  }

  readonly queueStatus = computed(() => this.queue()?.status ?? 'CLOSED');

  readonly servingEntry = computed(() =>
    this.timeline().find((e) => e.members.some((m) => m.status === 'SERVING')),
  );

  readonly servingMember = computed(() =>
    this.servingEntry()?.members.find((m) => m.status === 'SERVING'),
  );

  // True from the moment Call Next is clicked WHILE another action (e.g. End
  // Session) was still in flight ahead of it in _actionQueue$, until the
  // genuine confirming socket frame shows someone SERVING (or the request
  // errors). Only set in that specific case — see callNext() — because that's
  // the one window where an intermediate frame (reflecting the moment right
  // after the queued-ahead action committed, before Call Next's own request
  // has even reached the backend) can land and show "nobody serving", which
  // is honest, authoritative data, not staleness to paper over. Painting the
  // new client's name immediately in that window and then having it revert
  // when that frame lands is what actually flashed in prod — repeatedly, even
  // after several attempts to patch around it with a "hold the previous
  // value" trick. So instead of predicting, we simply don't display anything
  // uncertain: the circle shows a "Calling next person…" spinner for that
  // window and only ever shows a name once it's confirmed by a real frame.
  //
  // When nothing was queued ahead of Call Next (the common case — no recent
  // End Session), this stays false and the circle updates immediately from
  // the optimistic paint as normal; there's no intermediate frame to race in
  // that case, so instant painting was never actually the problem.
  readonly callNextWaiting = signal(false);

  readonly displayServingMember = computed(() =>
    this.callNextWaiting() ? null : (this.servingMember() ?? null),
  );

  readonly waitingEntries = computed(() =>
    this.timeline().filter((e) => e.members.every((m) => m.status === 'WAITING')),
  );

  readonly servingPartyMembers = computed(() => {
    const entry = this.servingEntry();
    if (!entry) return [];
    return entry.members.filter((m) => m.status === 'WAITING' || m.status === 'SERVING');
  });

  // A freshly staffAddToQueue()'d entry paints with a client-generated temp_
  // id; it is unconfirmed data by definition (the backend has never seen it),
  // so it counts as locked until the socket replaces it with the real entry.
  // Folding temp_ into isLocked() means every button only ever asks one
  // question — "is this row waiting on the server?" — instead of also
  // hand-checking temp_ ids separately.
  private _isTempId(id: string): boolean {
    return id.startsWith('temp_');
  }

  // The single gate every optimistic-row button reads. True while the row is
  // locked: either an action on it is in flight (pending), or it's a temp_
  // row not yet confirmed by the server.
  isLocked(id: string | undefined | null): boolean {
    return !!id && (this._isTempId(id) || this.isPending(id));
  }

  // Call-next promotes whoever is head-of-line. Disabled if the head row is
  // locked (temp_ or mid-action) or if anyone is already serving — the backend
  // enforces one serving entry at a time (a 409 otherwise). The optimistic
  // paint for an End-Session-style action clears servingEntry() right away,
  // so this can read false before that action has committed backend-side —
  // that's fine: _runLocked's serial action queue (see its comment) is what
  // guarantees Call Next's request won't actually reach the backend until
  // End Session's has settled, so the button doesn't need to stay disabled
  // for that window too.
  readonly hasServingEntry = computed(() => !!this.servingEntry());

  readonly nextIsLocked = computed(() => this.isLocked(this.waitingEntries()[0]?.entryId));

  readonly queueListEntries = computed(() => {
    const serving = this.servingEntry();
    const waiting = this.waitingEntries();
    return serving ? [serving, ...waiting] : waiting;
  });

  private readonly _elapsedSeconds = computed(() => {
    this._tick();
    const servedAt = this.displayServingMember()?.servedAt;
    if (!servedAt) return 0;
    return Math.floor((Date.now() - new Date(servedAt).getTime()) / 1000);
  });

  readonly timerFromServedAt = computed(() => {
    const s = this._elapsedSeconds();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });

  readonly estimatedFinishTime = computed(() => {
    const member = this.displayServingMember();
    if (!member?.servedAt) return null;
    const finishMs = new Date(member.servedAt).getTime() + member.serviceDuration * 60 * 1000;
    return new Date(finishMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });

  readonly ringCircumference = RING_CIRCUMFERENCE;

  // Progress ring for the "Current Client" circle — time-based, not
  // position-based (there's no queue position for the one client currently
  // being served): fills as elapsed time approaches the member's
  // serviceDuration. Pure derivation off _elapsedSeconds(), which already
  // ticks correctly every second via _tick() — no local anchor state, so this
  // can't get stuck the way the customer countdown once did. Clamped at 1 so
  // a session running past its estimated duration shows a full ring rather
  // than overflowing the arc.
  readonly ringProgress = computed(() => {
    const member = this.displayServingMember();
    if (!member?.servedAt || !member.serviceDuration) return 0;
    const elapsed = this._elapsedSeconds();
    return Math.min(1, Math.max(0, elapsed / (member.serviceDuration * 60)));
  });

  readonly ringDashOffset = computed(() => RING_CIRCUMFERENCE * (1 - this.ringProgress()));

  readonly liveWaitMinutes = computed((): Map<string, number> => {
    this._tick();
    const elapsedMinutes = Math.floor(this._elapsedSeconds() / 60);
    const map = new Map<string, number>();
    for (const entry of this.timeline()) {
      map.set(entry.entryId, Math.max(0, entry.estimatedWaitMinutes - elapsedMinutes));
    }
    return map;
  });

  readonly memberWaitMinutes = computed((): Map<string, number> => {
    this._tick();
    const elapsedMinutes = Math.floor(this._elapsedSeconds() / 60);
    const map = new Map<string, number>();
    for (const entry of this.timeline()) {
      const isServing = entry.members.some((m) => m.status === 'SERVING');
      let pendingDuration = 0;
      for (const member of entry.members) {
        if (member.status === 'SERVED') {
          map.set(member.memberId, 0);
          continue;
        }
        if (member.status === 'SERVING') {
          map.set(member.memberId, 0);
          pendingDuration = member.serviceDuration - elapsedMinutes;
          continue;
        }
        // WAITING
        const wait = isServing
          ? Math.max(0, pendingDuration)
          : Math.max(0, entry.estimatedWaitMinutes + pendingDuration);
        map.set(member.memberId, wait);
        pendingDuration += member.serviceDuration;
      }
    }
    return map;
  });

  init(salonId: string, queueId: string): void {
    this._socketInitialReceived = false;
    this._activeQueueId = queueId;
    this._loadQueueStatus(salonId, queueId);
    // connect() is idempotent (no-op if already connected) — this console must
    // not depend on something else having opened the socket first.
    this._socket.connect();
    this._socket
      .queueTimeline$(queueId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((entries) => {
        this._socketInitialReceived = true;
        // Clears the Call Next spinner once a genuine frame — not the
        // optimistic paint — shows the targeted entry's leader SERVING. See
        // callNextWaiting's comment for why this can't just watch
        // servingMember(), which the optimistic paint also satisfies.
        if (this.callNextWaiting()) {
          const targetId = this._callNextTargetEntryId();
          const confirmed = entries
            .find((e) => e.entryId === targetId)
            ?.members.some((m) => m.status === 'SERVING');
          if (confirmed) {
            this.callNextWaiting.set(false);
            this._callNextTargetEntryId.set(null);
          }
        }
        // Authoritative — no reconciliation, no timestamp comparison. The
        // `timeline` computed merges this with any still-unconfirmed local
        // temp add and drops confirmed temps (via _setServerTimeline's prune).
        this._setServerTimeline(entries);
        this.loading.set(false);
      });
    this._socket.watchQueueAsStaff(queueId);
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(retry(1), takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          // Skip if the socket already delivered a fresher frame — the socket is
          // the authoritative source and always contains the latest server state.
          if (this._socketInitialReceived) return;
          this._setServerTimeline(res.body.timeline);
          this.loading.set(false);
        },
        error: () => {
          if (this._socketInitialReceived) return; // socket already loaded — not a failure
          this.loading.set(false);
          this.error.set(true);
        },
      });
    this._startTick();
  }

  destroy(queueId: string): void {
    this._socket.unwatchQueue(queueId);
    this._stopTick();
  }

  setStatus(salonId: string, queueId: string, status: 'OPEN' | 'PAUSED' | 'CLOSED'): void {
    if (this.acting()) return;
    const prev = this.queue();
    this.acting.set(true);
    this._socketPredict.run({
      signal: this.queue,
      apply: (q) => (q ? { ...q, status } : q),
      request: () =>
        queueManagementControllerSetStatus(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          body: { status },
        }),
      onSuccess: (res) => this.queue.set(res.body),
      onError: () => {
        this.queue.set(prev);
        this._toast.error('Failed to update queue status');
      },
      destroyRef: this._destroyRef,
      onSettled: () => this.acting.set(false),
    });
  }

  callNext(salonId: string, queueId: string, onResolveNeeded: () => void): void {
    const waiting = this.waitingEntries();
    if (waiting.length === 0) return;
    if (this.hasServingEntry()) return;
    const head = waiting[0];
    if (this.isLocked(head.entryId)) return;

    // Captured once here rather than re-derived from waitingEntries()[0] —
    // the optimistic paint below immediately promotes this entry out of
    // "waiting" (it becomes SERVING), so waitingEntries()[0] would already
    // point at a DIFFERENT entry by the next read. Used only by the frame
    // subscriber in init() to know which entry's confirming frame clears
    // callNextWaiting — see that subscriber's comment.
    this._callNextTargetEntryId.set(head.entryId);
    // See callNextWaiting's comment: only wait-and-spin when something (e.g.
    // End Session) was already in flight ahead of this in _actionQueue$ — an
    // intermediate frame reflecting that action's commit, but not yet this
    // one's, can land in that window. With nothing queued ahead, there's no
    // such frame to race and painting immediately (below) is safe, as it
    // always was before this whole investigation started.
    if (this._actionInFlight) this.callNextWaiting.set(true);
    // Lock the leader's member id too, not just the entry — isLocked(id) on
    // the current-client row checks the MEMBER id (Done/+mins buttons), and
    // the promotion to SERVING here is an unconfirmed optimistic paint until
    // this request settles. Without this, Done/+mins on the freshly-promoted
    // member were clickable immediately, one optimistic write racing another.
    const leaderId = head.members.find((m) => m.isLeader)?.memberId;
    this._runLocked({
      ids: leaderId ? [head.entryId, leaderId] : [head.entryId],
      apply: (t) =>
        t.map((e) =>
          e.entryId !== head.entryId
            ? e
            : {
                ...e,
                members: e.members.map((m) =>
                  m.isLeader && m.status === 'WAITING'
                    ? { ...m, status: 'SERVING' as const, servedAt: new Date().toISOString() }
                    : m,
                ),
              },
        ),
      request: () =>
        queueManagementControllerCallNext(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
        }),
      onError: (err) => {
        // Nothing will ever confirm this target now — stop waiting/spinning.
        this.callNextWaiting.set(false);
        this._callNextTargetEntryId.set(null);
        const body = (err as { error?: unknown })?.error;
        if (
          isApiError(body) &&
          (body.code === ErrorCodes.ENTRY_ALREADY_SERVING ||
            body.code === ErrorCodes.ENTRY_NOT_WAITING)
        ) {
          onResolveNeeded();
        } else {
          this._toast.info('Resolve the current client first before calling the next one.');
        }
      },
    });
  }

  endSession(salonId: string, queueId: string): void {
    const member = this.servingMember();
    const entry = this.servingEntry();
    if (!member || !entry) return;
    if (this.isLocked(entry.entryId) || this.isLocked(member.memberId)) return;
    this._confirmDialog
      .open({
        title: 'End session?',
        message: `Mark ${member.memberName} as complete?`,
        confirmLabel: 'End Session',
        danger: false,
      })
      .pipe(
        filter((ok) => ok),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        this._runLocked({
          ids: [entry.entryId, member.memberId],
          apply: (t) =>
            t.map((e) =>
              e.entryId !== entry.entryId ? e : this._completeAndPromoteNext(e, member.memberId),
            ),
          request: () =>
            queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, {
              salonId,
              queueId,
              entryId: entry.entryId,
              memberId: member.memberId,
            }),
        });
      });
  }

  endAllMembers(salonId: string, queueId: string): void {
    const entry = this.servingEntry();
    if (!entry) return;
    if (this.isLocked(entry.entryId)) return;
    this._runLocked({
      ids: [entry.entryId],
      apply: (t) =>
        t.map((e) =>
          e.entryId !== entry.entryId
            ? e
            : { ...e, members: e.members.map((m) => ({ ...m, status: 'SERVED' as const })) },
        ),
      request: () =>
        queueManagementControllerCompleteAllMembers(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          entryId: entry.entryId,
        }),
    });
  }

  completeMember(salonId: string, queueId: string, entryId: string, memberId: string): void {
    if (this.isLocked(entryId) || this.isLocked(memberId)) return;
    this._runLocked({
      ids: [entryId, memberId],
      apply: (t) =>
        t.map((e) => (e.entryId !== entryId ? e : this._completeAndPromoteNext(e, memberId))),
      request: () =>
        queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          entryId,
          memberId,
        }),
    });
  }

  noShow(salonId: string, queueId: string, entryId: string): void {
    if (this.isLocked(entryId)) return;
    this._confirmDialog
      .open({
        title: 'Mark as no-show?',
        message: 'This client will be removed from the queue.',
        confirmLabel: 'No-show',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        this._runLocked({
          ids: [entryId],
          apply: (t) => t.filter((e) => e.entryId !== entryId),
          request: () =>
            queueManagementControllerMarkNoShow(this._http, this._apiConfig.rootUrl, {
              salonId,
              queueId,
              entryId,
            }),
        });
      });
  }

  cancelEntry(salonId: string, queueId: string, entryId: string): void {
    if (this.isLocked(entryId)) return;
    this._confirmDialog
      .open({
        title: 'Cancel entry?',
        message: 'Remove this client from the queue entirely.',
        confirmLabel: 'Yes',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        this._runLocked({
          ids: [entryId],
          apply: (t) => t.filter((e) => e.entryId !== entryId),
          request: () =>
            queueManagementControllerCancelEntry(this._http, this._apiConfig.rootUrl, {
              salonId,
              queueId,
              entryId,
            }),
        });
      });
  }

  serveMember(salonId: string, queueId: string, entryId: string, memberId: string): void {
    if (this.isLocked(entryId) || this.isLocked(memberId)) return;
    this._runLocked({
      ids: [entryId, memberId],
      apply: (t) =>
        t.map((e) =>
          e.entryId !== entryId
            ? e
            : {
                ...e,
                members: e.members.map((m) =>
                  m.memberId === memberId
                    ? { ...m, status: 'SERVING' as const, servedAt: new Date().toISOString() }
                    : m,
                ),
              },
        ),
      request: () =>
        queueManagementControllerServeMember(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          entryId,
          memberId,
        }),
    });
  }

  extendMember(
    salonId: string,
    queueId: string,
    entryId: string,
    memberId: string,
    body: ExtendMemberDto,
  ): void {
    if (this.isLocked(entryId) || this.isLocked(memberId)) return;
    this._runLocked({
      ids: [entryId, memberId],
      apply: (t) =>
        t.map((e) =>
          e.entryId !== entryId
            ? e
            : {
                ...e,
                members: e.members.map((m) =>
                  m.memberId === memberId
                    ? { ...m, serviceDuration: m.serviceDuration + body.extraMinutes }
                    : m,
                ),
              },
        ),
      request: () =>
        queueManagementControllerExtendMember(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          entryId,
          memberId,
          body,
        }),
    });
  }

  staffAddToQueue(
    salonId: string,
    queueId: string,
    members: { memberName: string; serviceId?: string }[],
    onSuccess?: () => void,
  ): void {
    // Build a temp entry from form data + staff services for instant paint
    const services = this.staffServices();
    const current = this.timeline();
    const positions = current.map((e) => e.position).filter((p): p is number => p !== null);
    const lastPosition = positions.length > 0 ? Math.max(...positions) : 0;
    const lastWait =
      current.length > 0 ? Math.max(...current.map((e) => e.estimatedWaitMinutes)) : 0;
    const now = new Date().toISOString();
    const tempEntry: TimelineEntryDto = {
      entryId: `temp_${crypto.randomUUID()}`,
      position: lastPosition + 1,
      estimatedWaitMinutes: lastWait,
      isUpcoming: false,
      scheduledAt: null,
      type: 'WALK_IN',
      updatedAt: now,
      members: members.map((m, i) => {
        const svc = services.find((s) => s.serviceId === m.serviceId);
        return {
          memberId: `temp_${crypto.randomUUID()}`,
          memberName: m.memberName,
          isLeader: i === 0,
          status: 'WAITING' as const,
          servedAt: null,
          serviceId: m.serviceId ?? null,
          serviceName: svc?.service.name ?? null,
          serviceDuration: svc?.service.duration ?? 30,
          phone: null,
          updatedAt: now,
        };
      }),
    };

    // The temp entry paints into the _optimisticAdds OVERLAY, never into
    // _serverTimeline — so it can never be clobbered by, or race, an incoming
    // socket frame. isLocked() blocks every action on it (temp_ ids are always
    // locked). The `timeline` computed shows it until its real id (recorded
    // from the POST response in _addRealIds) appears in the server timeline —
    // at that point it drops out of the merge on its own, synchronously, with
    // no window where both or neither render.
    //
    // dedupeKey (keyed on the payload, since there's no entity id yet) stops a
    // double-tap from painting two temp entries and firing two POSTs.
    const tempEntryId = tempEntry.entryId;
    const tempMemberIds = tempEntry.members.map((m) => m.memberId);
    this._beginPending(tempEntryId, ...tempMemberIds);
    this._addRealIds.update((m) => new Map(m).set(tempEntryId, null));
    this._addBaselineCounts.set(tempEntryId, this._serverTimeline().length);
    const accepted = this._socketPredict.run({
      signal: this._optimisticAdds,
      apply: (t) => [...t, tempEntry],
      request: () =>
        walkInControllerStaffAddToQueue(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          body: { members },
        }),
      onSuccess: (res) => {
        // Record the real id — the `timeline` computed hides the temp from the
        // rendered view the instant this changes. The prune here reclaims the
        // dead overlay state for the fast-network case (frame already landed
        // before this resolved, so no later server write would prune it);
        // otherwise _setServerTimeline prunes when the confirming frame lands.
        this._addRealIds.update((m) => new Map(m).set(tempEntryId, res.body.id));
        this._pruneConfirmedAdds();
      },
      onError: () => {
        this._refetchTimeline(queueId);
        this._removePendingAdd(tempEntryId);
      },
      destroyRef: this._destroyRef,
      dedupeKey: `QueueConsoleService.staffAddToQueue:${queueId}:${members.map((m) => `${m.memberName}:${m.serviceId ?? ''}`).join(',')}`,
      onSettled: () => this._clearPending(tempEntryId, ...tempMemberIds),
    });
    // dedupeKey dropped this call (double-tap) — nothing painted; undo tracking.
    if (!accepted) this._removePendingAdd(tempEntryId);
    // Optimistic: the temp entry already painted onto the timeline, so close
    // the modal and toast now rather than waiting on the network round-trip.
    // If the request actually fails, onError above refetches the authoritative
    // timeline and the entry disappears — the modal has already closed by
    // then, matching every other optimistic mutation in the app. Only fire if
    // run() actually accepted the op — a dedupeKey-dropped re-entrant call
    // (double-tap) did nothing and shouldn't claim success.
    if (accepted) {
      this._toast.success('Client added to queue.');
      onSuccess?.();
    }
  }

  // Same optimistic-temp-entry shape as staffAddToQueue — a barber booking an
  // appointment on a client's behalf needs the same instant-paint UX. The
  // temp entry carries scheduledAt so the console row can show it's an
  // appointment, not a walk-in, the moment it paints.
  staffBookAppointment(
    salonId: string,
    queueId: string,
    date: string,
    startTime: string,
    members: { memberName: string; serviceId: string }[],
    onSuccess?: () => void,
    onError?: () => void,
  ): void {
    const services = this.staffServices();
    const current = this.timeline();
    const positions = current.map((e) => e.position).filter((p): p is number => p !== null);
    const lastPosition = positions.length > 0 ? Math.max(...positions) : 0;
    const lastWait =
      current.length > 0 ? Math.max(...current.map((e) => e.estimatedWaitMinutes)) : 0;
    const now = new Date().toISOString();
    // Optimistic-paint only — a slightly-off timezone interpretation here is
    // cosmetic (this temp entry is immediately replaced by the real server
    // row once the request resolves), unlike BookingService's own
    // salon-timezone-aware scheduledAt on the actual persisted entry.
    const scheduledAt = new Date(`${date}T${startTime}:00`).toISOString();
    const tempEntry: TimelineEntryDto = {
      entryId: `temp_${crypto.randomUUID()}`,
      position: lastPosition + 1,
      estimatedWaitMinutes: lastWait,
      isUpcoming: true,
      scheduledAt,
      type: 'APPOINTMENT',
      updatedAt: now,
      members: members.map((m, i) => {
        const svc = services.find((s) => s.serviceId === m.serviceId);
        return {
          memberId: `temp_${crypto.randomUUID()}`,
          memberName: m.memberName,
          isLeader: i === 0,
          status: 'WAITING' as const,
          servedAt: null,
          serviceId: m.serviceId,
          serviceName: svc?.service.name ?? null,
          serviceDuration: svc?.service.duration ?? 30,
          phone: null,
          updatedAt: now,
        };
      }),
    };

    const body: BookAppointmentDto = { date, startTime, members };
    const tempEntryId = tempEntry.entryId;
    const tempMemberIds = tempEntry.members.map((m) => m.memberId);
    this._beginPending(tempEntryId, ...tempMemberIds);
    this._addRealIds.update((m) => new Map(m).set(tempEntryId, null));
    this._addBaselineCounts.set(tempEntryId, this._serverTimeline().length);
    const accepted = this._socketPredict.run({
      signal: this._optimisticAdds,
      apply: (t) => [...t, tempEntry],
      request: () =>
        staffBookingControllerStaffBookAppointment(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          body,
        }),
      onSuccess: (res) => {
        this._addRealIds.update((m) => new Map(m).set(tempEntryId, res.body.id));
        this._pruneConfirmedAdds();
      },
      onError: () => {
        this._refetchTimeline(queueId);
        this._removePendingAdd(tempEntryId);
      },
      destroyRef: this._destroyRef,
      dedupeKey: `QueueConsoleService.staffBookAppointment:${queueId}:${date}:${startTime}:${members.map((m) => `${m.memberName}:${m.serviceId}`).join(',')}`,
      onSettled: () => this._clearPending(tempEntryId, ...tempMemberIds),
    });
    if (!accepted) {
      this._removePendingAdd(tempEntryId);
      onError?.();
      return;
    }
    this._toast.success('Appointment booked.');
    onSuccess?.();
  }

  formatWait(minutes: number): string {
    if (minutes < 1) return '< 1m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  liveWait(entryId: string): string {
    return this.formatWait(this.liveWaitMinutes().get(entryId) ?? 0);
  }

  memberWait(memberId: string): string {
    return this.formatWait(this.memberWaitMinutes().get(memberId) ?? 0);
  }

  private _refetchTimeline(queueId: string): void {
    this._toast.error('Action failed — refreshing queue');
    this._silentRefetchTimeline(queueId);
  }

  // Same REST refetch, no "failed" toast — for recovering from a missing
  // confirming socket frame rather than an actual request error (e.g. the
  // add-fallback in staffAddToQueue).
  private _silentRefetchTimeline(queueId: string): void {
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(retry(1), takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this._setServerTimeline(res.body.timeline) });
  }

  private _loadQueueStatus(salonId: string, queueId: string): void {
    publicQueueControllerGetQueue(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(
        retry(1),
        tap((res) => this.queue.set(res.body)),
        switchMap((res) =>
          staffServicesControllerGetStaffServices(this._http, this._apiConfig.rootUrl, {
            salonId,
            staffId: res.body.staffId,
          }),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: (res) => this.staffServices.set(res.body),
        error: () => this._toast.error('Could not load queue status'),
      });
  }

  private _startTick(): void {
    this._tickInterval = setInterval(() => this._tick.update((n) => n + 1), 1000);
  }

  private _stopTick(): void {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }
}
