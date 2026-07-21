import { Injectable, OnDestroy, inject } from '@angular/core';
import { Observable, Subject, BehaviorSubject, ReplaySubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { TokenStore } from '../auth/token.store';
import { GuestStore } from '../guest/guest-store';
import { QueueSoundService } from '../queue/queue-sound.service';
import {
  TimelineEntryDto,
  QueueTimelinePayload,
  CustomerCalledPayload,
  ConnectionState,
} from './socket.types';

// FIXME: this whole self-action-suppression window is a timing-based patch,
// not the correct fix. A staff-initiated mutation (call next, add client,
// book appointment, etc.) confirms via the SAME queueTimeline broadcast a
// genuinely new customer-caused change would — the backend's source field
// says STAFF either way, and can't tell "my own action confirming" apart
// from "a colleague/admin acted on my queue" (see socket.types.ts's
// QueueUpdateSource doc). Guessing "if it arrived within N ms of my own
// action, it's probably an echo" is a heuristic, not a real signal — it can
// both false-negative (a colleague/admin genuinely acts on this queue within
// the window and gets wrongly suppressed) and, in theory, false-positive
// (our own action's frame is delayed past the window and rings when it
// shouldn't). The correct fix is a real per-action correlation id: the
// frontend generates one when dispatching a mutation, the backend echoes it
// back on that mutation's queue.updated payload, and the frontend suppresses
// only the exact frame carrying its own id — no timing window, no guessing.
// Revisit once that's worth the backend round-trip; shipping the window for
// now per explicit product sign-off on the tradeoff.
const SELF_ACTION_SUPPRESS_MS = 15000;

@Injectable({ providedIn: 'root' })
export class QueueSocketService implements OnDestroy {
  private readonly _tokenStore = inject(TokenStore);
  private readonly _guestStore = inject(GuestStore);
  private readonly _sound = inject(QueueSoundService);

  private _socket: Socket | null = null;
  private readonly _watchedQueues = new Set<string>();
  private readonly _watchedStaffQueues = new Set<string>();

  private readonly _timelines = new Map<string, ReplaySubject<TimelineEntryDto[]>>();
  // Last timeline frame pushed per queue — lets a consumer read the cached
  // frame synchronously (e.g. when re-displaying an already-watched queue)
  // without waiting for a fresh server push. Mirrors the ReplaySubject(1)
  // buffer, which RxJS doesn't expose for direct reads.
  private readonly _lastTimeline = new Map<string, TimelineEntryDto[]>();
  private readonly _serverTimes = new Map<string, ReplaySubject<string>>();
  private readonly _called = new Map<string, Subject<CustomerCalledPayload>>();
  private readonly _connectionState$ = new BehaviorSubject<ConnectionState>('disconnected');

  // Per-queue "I (this browser) just dispatched a staff action" timestamp —
  // set by QueueConsoleService right before it fires a mutation request, so
  // the console's own confirming frame doesn't ring the sound it just
  // suppressed for itself, per the module doc comment above.
  private readonly _selfActionAt = new Map<string, number>();

  readonly connectionState$ = this._connectionState$.asObservable();

  connect(): void {
    if (this._socket?.connected) return;

    const token = this._tokenStore.getAccessToken() ?? this._guestStore.getToken();
    this._socket = io(`${environment.socketUrl}/queues`, {
      auth: { token },
      transports: ['websocket'],
    });

    this._socket.on('connect', () => {
      this._connectionState$.next('connected');
      this._rejoinAll();
    });

    this._socket.on('disconnect', () => {
      this._connectionState$.next('reconnecting');
    });

    this._socket.on('connect_error', () => {
      this._connectionState$.next('reconnecting');
    });

    // The only live-update event name the gateway actually emits over the
    // wire (confirmed against queue.gateway.ts — 'queue.updated' is an
    // internal NestJS EventEmitter2 name only, never a socket.io event).
    this._socket.on('queueTimeline', (data: QueueTimelinePayload) => {
      this._lastTimeline.set(data.queueId, data.timeline);
      this._timelines.get(data.queueId)?.next(data.timeline);
      if (data.serverTime) this._serverTimes.get(data.queueId)?.next(data.serverTime);
      this._maybePlaySound(data);
    });

    // Wire event name is 'customerCalled' (no dot) — confirmed against
    // queue.gateway.ts. The previous 'customer.called' listener here never
    // fired against the real backend.
    this._socket.on('customerCalled', (payload: CustomerCalledPayload) => {
      this._called.get(payload.queueId)?.next(payload);
    });
  }

  disconnect(): void {
    this._socket?.disconnect();
    this._socket = null;
    this._watchedQueues.clear();
    this._watchedStaffQueues.clear();
    this._connectionState$.next('disconnected');
  }

  watchQueue(queueId: string): void {
    this._ensureTimelineSubject(queueId);
    this._watchedQueues.add(queueId);
    if (this._socket?.connected) {
      this._socket.emit('joinQueue', { queueId });
    }
  }

  watchQueueAsStaff(queueId: string): void {
    this._ensureTimelineSubject(queueId);
    this._watchedStaffQueues.add(queueId);
    if (this._socket?.connected) {
      this._socket.emit('joinQueueStaff', { queueId });
    }
  }

  unwatchQueue(queueId: string): void {
    this._watchedQueues.delete(queueId);
    this._watchedStaffQueues.delete(queueId);
    this._socket?.emit('leaveQueue', { queueId });
  }

  queueTimeline$(queueId: string): Observable<TimelineEntryDto[]> {
    this._ensureTimelineSubject(queueId);
    return this._timelines.get(queueId)!.asObservable();
  }

  /** The most recent timeline frame received for a queue, or null if none yet. */
  lastTimeline(queueId: string): TimelineEntryDto[] | null {
    return this._lastTimeline.get(queueId) ?? null;
  }

  // Server's clock at the moment the timeline was generated — used to correct
  // for client clock drift in elapsed-time displays (wait estimates, timers).
  serverTime$(queueId: string): Observable<string> {
    this._ensureTimelineSubject(queueId);
    return this._serverTimes.get(queueId)!.asObservable();
  }

  customerCalled$(queueId: string): Observable<CustomerCalledPayload> {
    if (!this._called.has(queueId)) {
      this._called.set(queueId, new Subject<CustomerCalledPayload>());
    }
    return this._called.get(queueId)!.asObservable();
  }

  // Called by QueueConsoleService immediately before dispatching any staff
  // mutation on this queue — see the class-level doc comment for why.
  markSelfAction(queueId: string): void {
    this._selfActionAt.set(queueId, Date.now());
  }

  private _maybePlaySound(data: QueueTimelinePayload): void {
    // The console/queue-sound feature is for barbers watching their OWN
    // queue console, not customers watching their position — both watch the
    // same queueId's socket room family (staff room vs. public room) on this
    // one connection, so gate on whether THIS client actually joined as
    // staff, not just on which queueId the frame is for.
    if (!this._watchedStaffQueues.has(data.queueId)) return;
    if (data.source === 'CUSTOMER') {
      this._sound.play();
      return;
    }
    if (data.source !== 'STAFF') return; // no source = initial join snapshot, never rings
    // FIXME: timing-based guess, not a real signal — see SELF_ACTION_SUPPRESS_MS's comment above.
    const selfAt = this._selfActionAt.get(data.queueId);
    const withinSelfWindow = selfAt !== undefined && Date.now() - selfAt < SELF_ACTION_SUPPRESS_MS;
    if (!withinSelfWindow) this._sound.play();
  }

  private _ensureTimelineSubject(queueId: string): void {
    if (!this._timelines.has(queueId)) {
      this._timelines.set(queueId, new ReplaySubject<TimelineEntryDto[]>(1));
    }
    if (!this._serverTimes.has(queueId)) {
      this._serverTimes.set(queueId, new ReplaySubject<string>(1));
    }
  }

  private _rejoinAll(): void {
    this._watchedQueues.forEach((id) => this._socket?.emit('joinQueue', { queueId: id }));
    this._watchedStaffQueues.forEach((id) => this._socket?.emit('joinQueueStaff', { queueId: id }));
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
