import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { ToastService } from '../toast/toast.service';
import { ChatSocketService } from './chat-socket.service';
import {
  ConversationEligibilityDto,
  ConversationItemDto,
  ConversationMessageDto,
  CreateConversationDto,
  MessageHistoryResponseDto,
  SalonBroadcastDto,
  SalonBroadcastResponseDto,
  SendMessageDto,
  UnreadCountDto,
} from './chat.types';
import { customerChatControllerGetUnreadCount } from '../../api/fn/chat/customer-chat-controller-get-unread-count';
import { customerChatControllerListMyConversations } from '../../api/fn/chat/customer-chat-controller-list-my-conversations';
import { salonChatControllerListSalonConversations } from '../../api/fn/chat/salon-chat-controller-list-salon-conversations';
import { salonChatControllerOpenConversation } from '../../api/fn/chat/salon-chat-controller-open-conversation';
import { customerChatControllerGetMessages } from '../../api/fn/chat/customer-chat-controller-get-messages';
import { customerChatControllerSendMessage } from '../../api/fn/chat/customer-chat-controller-send-message';
import { customerChatControllerMarkAsRead } from '../../api/fn/chat/customer-chat-controller-mark-as-read';
import { salonChatControllerSendBroadcast } from '../../api/fn/chat/salon-chat-controller-send-broadcast';
import { salonChatControllerCheckEligibility } from '../../api/fn/chat/salon-chat-controller-check-eligibility';
import { customerChatControllerBlockConversation } from '../../api/fn/chat/customer-chat-controller-block-conversation';
import { customerChatControllerUnblockConversation } from '../../api/fn/chat/customer-chat-controller-unblock-conversation';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(ChatSocketService);
  private readonly _toast = inject(ToastService);
  private readonly _router = inject(Router);
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _isBrowser = isPlatformBrowser(this._platformId);

  readonly unreadCount = signal<number>(0);

  constructor() {
    this._initSocketListeners();
    if (this._isBrowser) {
      this.refreshUnreadCount();
    }
  }

  private _initSocketListeners(): void {
    this._socket.connect();

    this._socket.badgeUpdated$.subscribe((payload) => {
      if (typeof payload.unreadCount === 'number') {
        this.unreadCount.set(payload.unreadCount);
      } else {
        this.refreshUnreadCount();
      }
      if (payload.lastMessage?.senderName && payload.lastMessage?.body) {
        this._toast.info(`${payload.lastMessage.senderName}: ${payload.lastMessage.body}`);
      }
    });

    this._socket.messageReceived$.subscribe(() => {
      this.refreshUnreadCount();
    });

    this._socket.staffDeactivated$.subscribe(() => {
      this._toast.error('Your account access has changed.');
      this._router.navigate(['/']);
    });
  }

  refreshUnreadCount(): void {
    this.getUnreadCount().subscribe({
      next: (res) => this.unreadCount.set(res.unreadCount),
      error: () => {},
    });
  }

  // ── 4.1 Eligibility Check ──────────────────────────────────────────────────
  checkEligibility(salonId: string, staffId: string): Observable<ConversationEligibilityDto> {
    return salonChatControllerCheckEligibility(this._http, this._apiConfig.rootUrl, {
      salonId,
      staffId,
    }).pipe(
      map((res) => res.body),
      catchError(() =>
        of<ConversationEligibilityDto>({
          canMessage: false,
          reason: 'NOT_ELIGIBLE',
        }),
      ),
    );
  }

  // ── 4.2 Global Unread Counter ──────────────────────────────────────────────
  getUnreadCount(): Observable<UnreadCountDto> {
    return customerChatControllerGetUnreadCount(this._http, this._apiConfig.rootUrl, {}).pipe(
      map((res) => res.body),
      tap((res) => this.unreadCount.set(res.unreadCount)),
    );
  }

  // ── 4.3 Customer Inbox List ────────────────────────────────────────────────
  getCustomerConversations(
    page = 1,
    limit = 50,
    q?: string,
  ): Observable<{ data: ConversationItemDto[]; meta: any }> {
    return customerChatControllerListMyConversations(this._http, this._apiConfig.rootUrl, {
      page,
      limit,
      q: q?.trim() || undefined,
    }).pipe(
      map((res) => ({
        data: res.body.data ?? [],
        meta: res.body.meta ?? { page, limit, total: 0, totalPages: 1 },
      })),
    );
  }

  // ── 4.4 Salon Inbox List ───────────────────────────────────────────────────
  getSalonConversations(
    salonId: string,
    page = 1,
    limit = 50,
    staffId?: string,
    q?: string,
  ): Observable<{ data: ConversationItemDto[]; meta: any }> {
    return salonChatControllerListSalonConversations(this._http, this._apiConfig.rootUrl, {
      salonId,
      page,
      limit,
      staffId: staffId || undefined,
      q: q?.trim() || undefined,
    }).pipe(
      map((res) => {
        let list = res.body.data ?? [];
        if (staffId) {
          list = list.filter((c) => c.staffId === staffId);
        }
        return {
          data: list,
          meta: res.body.meta ?? { page, limit, total: list.length, totalPages: 1 },
        };
      }),
    );
  }

  // ── 4.5 Create / Open Conversation (Idempotent) ────────────────────────────
  createOrOpenConversation(
    salonId: string,
    staffId?: string,
    metadata?: { customerId?: string; salonName?: string; staffName?: string; customerName?: string },
  ): Observable<ConversationItemDto> {
    const body: CreateConversationDto = {};
    if (staffId) body.staffId = staffId;
    if (metadata?.customerId) body.customerId = metadata.customerId;

    return salonChatControllerOpenConversation(this._http, this._apiConfig.rootUrl, {
      salonId,
      body,
    }).pipe(map((res) => res.body));
  }

  // ── 4.6 Message History (Keyset Pagination) ────────────────────────────────
  getMessageHistory(
    conversationId: string,
    before?: string,
    limit = 50,
  ): Observable<MessageHistoryResponseDto> {
    return customerChatControllerGetMessages(this._http, this._apiConfig.rootUrl, {
      id: conversationId,
      before,
      limit,
    }).pipe(
      map((res) => ({
        data: (res.body.data ?? []) as ConversationMessageDto[],
        hasMore: res.body.hasMore ?? false,
      })),
    );
  }

  // ── 4.7 Send Message ───────────────────────────────────────────────────────
  sendMessage(
    conversationId: string,
    payload: SendMessageDto,
  ): Observable<ConversationMessageDto> {
    return customerChatControllerSendMessage(this._http, this._apiConfig.rootUrl, {
      id: conversationId,
      body: {
        clientMessageId: payload.clientMessageId,
        body: payload.body,
        mediaUrl: payload.mediaUrl ?? undefined,
      },
    }).pipe(map((res) => res.body as ConversationMessageDto));
  }

  // ── 4.8 Mark Messages as Read ──────────────────────────────────────────────
  markAsRead(
    conversationId: string,
    upToMessageId?: string,
  ): Observable<void> {
    return customerChatControllerMarkAsRead(this._http, this._apiConfig.rootUrl, {
      id: conversationId,
      body: upToMessageId ? { upToMessageId } : {},
    }).pipe(
      map(() => undefined),
      tap(() => this.refreshUnreadCount()),
    );
  }

  // ── 4.9 Salon Broadcast ────────────────────────────────────────────────────
  sendBroadcast(salonId: string, payload: SalonBroadcastDto): Observable<SalonBroadcastResponseDto> {
    return salonChatControllerSendBroadcast(this._http, this._apiConfig.rootUrl, {
      salonId,
      body: {
        body: payload.body,
        mediaUrl: payload.mediaUrl ?? undefined,
      },
    }).pipe(map((res) => res.body));
  }

  // ── 4.10 Block & Unblock Thread ────────────────────────────────────────────
  blockConversation(conversationId: string): Observable<ConversationItemDto> {
    return customerChatControllerBlockConversation(this._http, this._apiConfig.rootUrl, {
      id: conversationId,
    }).pipe(map((res) => res.body));
  }

  unblockConversation(conversationId: string): Observable<ConversationItemDto> {
    return customerChatControllerUnblockConversation(this._http, this._apiConfig.rootUrl, {
      id: conversationId,
    }).pipe(map((res) => res.body));
  }
}
