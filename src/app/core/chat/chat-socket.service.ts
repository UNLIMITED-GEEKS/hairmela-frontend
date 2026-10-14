import { Injectable, OnDestroy, PLATFORM_ID, effect, inject, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { AppResumeService } from '../native/app-resume.service';
import { TokenStore } from '../auth/token.store';
import {
  ConversationMessageDto,
  MessageStatusUpdatedPayload,
  TypingIndicatorPayload,
  InboxBadgeUpdatedPayload,
} from './chat.types';

@Injectable({ providedIn: 'root' })
export class ChatSocketService implements OnDestroy {
  private readonly _tokenStore = inject(TokenStore);
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _resume = inject(AppResumeService);
  private _joinAck?: (res: { status: 'joined' | 'forbidden' }) => void;

  private _socket: Socket | null = null;
  private _currentConversationId: string | null = null;
  private readonly _isBrowser = isPlatformBrowser(this._platformId);

  private readonly _messageReceived$ = new Subject<ConversationMessageDto>();
  private readonly _statusUpdated$ = new Subject<MessageStatusUpdatedPayload>();
  private readonly _typingIndicator$ = new Subject<TypingIndicatorPayload>();
  private readonly _badgeUpdated$ = new Subject<InboxBadgeUpdatedPayload>();
  private readonly _staffDeactivated$ = new Subject<{ salonId: string }>();
  private readonly _reconnected$ = new Subject<void>();

  readonly messageReceived$: Observable<ConversationMessageDto> =
    this._messageReceived$.asObservable();
  readonly statusUpdated$: Observable<MessageStatusUpdatedPayload> =
    this._statusUpdated$.asObservable();
  readonly typingIndicator$: Observable<TypingIndicatorPayload> =
    this._typingIndicator$.asObservable();
  readonly badgeUpdated$: Observable<InboxBadgeUpdatedPayload> = this._badgeUpdated$.asObservable();
  readonly staffDeactivated$: Observable<{ salonId: string }> =
    this._staffDeactivated$.asObservable();
  readonly reconnected$ = this._reconnected$.asObservable();

  constructor() {
    if (this._isBrowser) {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
      window.addEventListener('online', this._onResume);
    }
    effect(() => {
      if (this._resume.resumed() > 0) untracked(this._onResume);
    });
  }

  private readonly _onVisibilityChange = () => {
    if (document.visibilityState === 'visible') this._onResume();
  };

  private readonly _onResume = () => {
    if (!this._tokenStore.getAccessToken()) return;
    this.connect();
    this._reconnected$.next();
  };

  connect(): void {
    if (!this._isBrowser) return;
    if (this._socket?.active) return;

    const token = this._tokenStore.getAccessToken();
    if (!token) return;

    try {
      if (this._socket) {
        this._socket.removeAllListeners();
        this._socket.disconnect();
      }

      this._socket = io(`${environment.socketUrl}/chat`, {
        // Socket.io calls this again on reconnect, after HTTP may have
        // refreshed the access token while the app was in the background.
        auth: (callback) => callback({ token: this._tokenStore.getAccessToken() }),
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
      });

      this._socket.on('connect', () => {
        if (this._currentConversationId) {
          this._socket?.emit(
            'conversation:join',
            { conversationId: this._currentConversationId },
            this._joinAck,
          );
        }
        this._reconnected$.next();
      });

      this._socket.on('connect_error', (err) => {
        console.debug('[ChatSocket] connection notice:', err.message);
      });

      this._socket.on('message:new', (msg: ConversationMessageDto) => {
        this._messageReceived$.next(msg);
      });

      this._socket.on('message:status_updated', (payload: MessageStatusUpdatedPayload) => {
        this._statusUpdated$.next(payload);
      });

      this._socket.on('typing:update', (payload: TypingIndicatorPayload) => {
        this._typingIndicator$.next(payload);
      });

      this._socket.on('typing:indicator', (payload: TypingIndicatorPayload) => {
        this._typingIndicator$.next(payload);
      });

      this._socket.on('inbox:badge_updated', (payload: InboxBadgeUpdatedPayload) => {
        this._badgeUpdated$.next(payload);
      });

      this._socket.on('staff:deactivated', (payload: { salonId: string }) => {
        this._staffDeactivated$.next(payload);
      });
    } catch (e) {
      console.debug('[ChatSocket] Init notice:', e);
    }
  }

  joinConversation(
    conversationId: string,
    ack?: (res: { status: 'joined' | 'forbidden' }) => void,
  ): void {
    this._currentConversationId = conversationId;
    this._joinAck = ack;
    if (this._socket?.connected) {
      this._socket.emit('conversation:join', { conversationId }, ack);
    } else {
      this.connect();
    }
  }

  leaveConversation(conversationId: string, ack?: (res: { status: 'left' }) => void): void {
    if (this._currentConversationId === conversationId) {
      this._currentConversationId = null;
      this._joinAck = undefined;
    }
    if (this._socket?.connected) this._socket.emit('conversation:leave', { conversationId }, ack);
  }

  startTyping(conversationId: string): void {
    if (this._socket?.connected) this._socket.emit('typing:start', { conversationId });
  }

  stopTyping(conversationId: string): void {
    if (this._socket?.connected) this._socket.emit('typing:stop', { conversationId });
  }

  disconnect(): void {
    if (this._socket) {
      this._socket.removeAllListeners();
      this._socket.disconnect();
      this._socket = null;
      this._currentConversationId = null;
      this._joinAck = undefined;
    }
  }

  ngOnDestroy(): void {
    if (this._isBrowser) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      window.removeEventListener('online', this._onResume);
    }
    this.disconnect();
  }
}
