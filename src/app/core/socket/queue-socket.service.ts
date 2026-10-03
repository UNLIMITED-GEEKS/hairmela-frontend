import { Injectable, OnDestroy, inject } from '@angular/core';
import { Observable, Subject, BehaviorSubject, ReplaySubject, Subscription } from 'rxjs';
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
import { PayloadEncryptionService } from '../payload-encryption/payload-encryption.service';
import { EncryptedSocketEnvelope } from '../payload-encryption/payload-encryption.types';

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
  private readonly _encryption = inject(PayloadEncryptionService);

  private _socket: Socket | null = null;
  private _connectPromise: Promise<void> | null = null;
  private readonly _encryptionSubscription: Subscription;
  private readonly _watchedQueues = new Set<string>();
  private readonly _watchedStaffQueues = new Set<string>();
  // Refcounts staff-watch callers per queueId. More than one caller can watch
  // the same staff room independently — e.g. the queue-console page and the
  // background queue-sound watcher (QueueSoundWatcherService) when the barber
  // is sitting on their own console. Without refcounting, whichever unwatches
  // first would drop the room out from under the other.
  private readonly _staffWatchRefs = new Map<string, number>();

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

  constructor() {
    this._encryptionSubscription = this._encryption.sessionChanged$.subscribe(() => {
      if (!this._socket) return;
      // Auth responses publish the replacement ticket before AuthService stores
      // the replacement access token. Reconnect on the next microtask so the
      // socket sends the matching token/ticket pair.
      queueMicrotask(() => {
        this._socket?.disconnect();
        this._socket = null;
        this.connect();
      });
    });
  }

  connect(): void {
    void this._connect();
  }

  private async _connect(): Promise<void> {
    if (this._socket?.connected && this._encryption.socketSessionIsCurrent()) return;
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = this._openSocket().finally(() => {
      this._connectPromise = null;
    });
    return this._connectPromise;
  }

  private async _openSocket(): Promise<void> {
    if (this._socket) {
      this._socket.disconnect();
      this._socket = null;
    }

    const token = this._tokenStore.getAccessToken() ?? this._guestStore.getToken();
    const encryptionSession = await this._encryption.ensureSession();
    this._socket = io(`${environment.socketUrl}/queues`, {
      auth: {
        token,
        ...(encryptionSession
          ? {
              encryptionVersion: 1,
              encryptionTicket: encryptionSession.ticket,
            }
          : {}),
      },
      transports: ['websocket'],
    });

    this._socket.on('connect', () => {
      this._connectionState$.next('connected');
      this._rejoinAll();
    });

    this._socket.on('disconnect', (reason) => {
      this._connectionState$.next('reconnecting');

      // A server-initiated disconnect disables Socket.IO's automatic
      // reconnection. The backend uses exactly that path when the short-lived
      // payload-encryption ticket expires, so keeping the old socket here left
      // the app permanently "reconnecting". Establish a fresh encryption
      // session and socket; _rejoinAll() restores every active queue watch.
      if (reason === 'io server disconnect') {
        this._encryption.invalidate();
        this._socket = null;
        queueMicrotask(() => this.connect());
      }
    });

    this._socket.on('connect_error', () => {
      this._connectionState$.next('reconnecting');
    });

    // The only live-update event name the gateway actually emits over the
    // wire (confirmed against queue.gateway.ts — 'queue.updated' is an
    // internal NestJS EventEmitter2 name only, never a socket.io event).
    this._socket.on('queueTimeline', (payload: QueueTimelinePayload | EncryptedSocketEnvelope) => {
      void this._handleIncoming<QueueTimelinePayload>('queueTimeline', payload, (data) => {
        this._lastTimeline.set(data.queueId, data.timeline);
        this._timelines.get(data.queueId)?.next(data.timeline);
        if (data.serverTime) this._serverTimes.get(data.queueId)?.next(data.serverTime);
        this._maybePlaySound(data);
      }).catch(() => this.disconnect());
    });

    // Wire event name is 'customerCalled' (no dot) — confirmed against
    // queue.gateway.ts. The previous 'customer.called' listener here never
    // fired against the real backend.
    this._socket.on(
      'customerCalled',
      (payload: CustomerCalledPayload | EncryptedSocketEnvelope) => {
        void this._handleIncoming<CustomerCalledPayload>('customerCalled', payload, (data) => {
          this._called.get(data.queueId)?.next(data);
        }).catch(() => this.disconnect());
      },
    );
  }

  disconnect(): void {
    this._socket?.disconnect();
    this._socket = null;
    this._watchedQueues.clear();
    this._watchedStaffQueues.clear();
    this._staffWatchRefs.clear();
    this._connectionState$.next('disconnected');
  }

  watchQueue(queueId: string): void {
    this._ensureTimelineSubject(queueId);
    this._watchedQueues.add(queueId);
    if (this._socket?.connected) {
      void this._emit('joinQueue', { queueId });
    }
  }

  watchQueueAsStaff(queueId: string): void {
    this._ensureTimelineSubject(queueId);
    this._watchedStaffQueues.add(queueId);
    this._staffWatchRefs.set(queueId, (this._staffWatchRefs.get(queueId) ?? 0) + 1);
    if (this._socket?.connected) {
      void this._emit('joinQueueStaff', { queueId });
    }
  }

  unwatchQueue(queueId: string): void {
    this._watchedQueues.delete(queueId);

    // Staff watches are refcounted (see _staffWatchRefs): only the last staff
    // watcher for this queue actually drops it. A single decrement that leaves
    // refs > 0 keeps the staff set intact.
    const refs = this._staffWatchRefs.get(queueId) ?? 0;
    if (refs > 1) {
      this._staffWatchRefs.set(queueId, refs - 1);
    } else {
      this._staffWatchRefs.delete(queueId);
      this._watchedStaffQueues.delete(queueId);
    }

    // leaveQueue leaves BOTH the public and staff rooms for this socket (see
    // queue.gateway.ts), so only emit it once no watcher of either kind still
    // wants this queue — otherwise unmounting one watcher would tear the room
    // out from under a surviving one.
    if (!this._watchedQueues.has(queueId) && !this._watchedStaffQueues.has(queueId)) {
      void this._emit('leaveQueue', { queueId });
    }
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

  private async _emit(event: string, data: unknown): Promise<void> {
    await this._connect();
    if (!this._socket?.connected) return;
    const encrypted = await this._encryption.encryptSocket(event, data);
    this._socket.emit(event, encrypted ?? data);
  }

  private async _handleIncoming<T>(
    event: string,
    payload: T | EncryptedSocketEnvelope,
    handle: (value: T) => void,
  ): Promise<void> {
    if (
      payload &&
      typeof payload === 'object' &&
      'requestId' in payload &&
      'iv' in payload &&
      'ciphertext' in payload
    ) {
      handle(await this._encryption.decryptSocket<T>(event, payload as EncryptedSocketEnvelope));
      return;
    }
    handle(payload as T);
  }

  private _rejoinAll(): void {
    this._watchedQueues.forEach((id) => void this._emit('joinQueue', { queueId: id }));
    this._watchedStaffQueues.forEach((id) => void this._emit('joinQueueStaff', { queueId: id }));
  }

  ngOnDestroy(): void {
    this._encryptionSubscription.unsubscribe();
    this.disconnect();
  }
}
