import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, BehaviorSubject, ReplaySubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { TokenStore } from '../auth/token.store';
import { inject } from '@angular/core';
import { TimelineEntryDto, CustomerCalledPayload, ConnectionState } from './socket.types';

@Injectable({ providedIn: 'root' })
export class QueueSocketService implements OnDestroy {
  private readonly _tokenStore = inject(TokenStore);

  private _socket: Socket | null = null;
  private readonly _watchedQueues = new Set<string>();
  private readonly _watchedStaffQueues = new Set<string>();

  private readonly _timelines = new Map<string, ReplaySubject<TimelineEntryDto[]>>();
  private readonly _called = new Map<string, Subject<CustomerCalledPayload>>();
  private readonly _connectionState$ = new BehaviorSubject<ConnectionState>('disconnected');

  readonly connectionState$ = this._connectionState$.asObservable();

  connect(): void {
    if (this._socket?.connected) return;

    const token = this._tokenStore.getAccessToken();
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

    this._socket.on('queueTimeline', (data: { queueId: string; timeline: TimelineEntryDto[] }) => {
      this._timelines.get(data.queueId)?.next(data.timeline);
    });

    this._socket.on('queue.updated', (data: { queueId: string; timeline: TimelineEntryDto[] }) => {
      this._timelines.get(data.queueId)?.next(data.timeline);
    });

    this._socket.on('customer.called', (payload: CustomerCalledPayload) => {
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
    this._watchedQueues.add(queueId);
    this._socket?.emit('joinQueue', { queueId });
  }

  watchQueueAsStaff(queueId: string): void {
    this._watchedStaffQueues.add(queueId);
    this._socket?.emit('joinQueueStaff', { queueId });
  }

  unwatchQueue(queueId: string): void {
    this._watchedQueues.delete(queueId);
    this._watchedStaffQueues.delete(queueId);
    this._socket?.emit('leaveQueue', { queueId });
  }

  queueTimeline$(queueId: string): Observable<TimelineEntryDto[]> {
    if (!this._timelines.has(queueId)) {
      this._timelines.set(queueId, new ReplaySubject<TimelineEntryDto[]>(1));
    }
    return this._timelines.get(queueId)!.asObservable();
  }

  customerCalled$(queueId: string): Observable<CustomerCalledPayload> {
    if (!this._called.has(queueId)) {
      this._called.set(queueId, new Subject<CustomerCalledPayload>());
    }
    return this._called.get(queueId)!.asObservable();
  }

  private _rejoinAll(): void {
    this._watchedQueues.forEach((id) => this._socket?.emit('joinQueue', { queueId: id }));
    this._watchedStaffQueues.forEach((id) => this._socket?.emit('joinQueueStaff', { queueId: id }));
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
