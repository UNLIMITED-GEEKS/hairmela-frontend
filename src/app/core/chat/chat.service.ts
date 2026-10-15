import { Injectable, PLATFORM_ID, inject, signal, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import {
  Observable,
  Subject,
  catchError,
  defer,
  EMPTY,
  expand,
  filter,
  finalize,
  map,
  of,
  reduce,
  shareReplay,
  tap,
} from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { ToastService } from '../toast/toast.service';
import { CacheRegistry } from '../caching/cache-registry/cache-registry.service';
import { SessionRequestCache } from '../caching/session-request-cache';
import { PaginatedMetaDto } from '../../api/models/paginated-meta-dto';
import { CurrentUserStore } from '../auth/current-user.store';
import { ChatSocketService } from './chat-socket.service';
import {
  ConversationEligibilityDto,
  ConversationItemDto,
  ConversationMessageDto,
  CreateConversationDto,
  MessageHistoryResponseDto,
  MessageStatus,
  MessageStatusUpdatedPayload,
  InboxBadgeUpdatedPayload,
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

type Inbox = { data: ConversationItemDto[]; meta: PaginatedMetaDto };
interface InboxQuery {
  salonId?: string;
  staffId?: string;
  page: number;
  limit: number;
  q?: string;
}
type InboxSnapshot = Inbox & { query: InboxQuery };
interface ThreadState {
  messages: WritableSignal<ConversationMessageDto[]>;
  history?: { hasMore: boolean; anchor?: ConversationMessageDto };
  receipts: Map<string, MessageStatusUpdatedPayload>;
  active: boolean;
  pending: number;
}
const MAX_CACHED_THREADS = 50;
const MAX_CACHED_MESSAGES = 200;
const STATUS_ORDER: Record<MessageStatus, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(ChatSocketService);
  private readonly _toast = inject(ToastService);
  private readonly _router = inject(Router);
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _isBrowser = isPlatformBrowser(this._platformId);

  private readonly _user = inject(CurrentUserStore);
  private readonly _inboxes = new SessionRequestCache<InboxSnapshot>();
  private readonly _conversations = new Map<
    string,
    { value: ConversationItemDto; revision: number }
  >();
  private readonly _threads = new Map<string, ThreadState>();
  private readonly _historyRequests = new Map<string, Observable<MessageHistoryResponseDto>>();
  private _session = 0;
  private _revision = 0;
  private _inboxInvalidation = 0;
  private _unreadRequestId = 0;
  readonly inboxUpdated$ = new Subject<void>();
  readonly inboxRefresh$ = new Subject<void>();

  readonly unreadCount = signal<number>(0);

  constructor() {
    inject(CacheRegistry).register(this);
    this._initSocketListeners();
    if (this._isBrowser) {
      this.refreshUnreadCount();
    }
  }

  private _initSocketListeners(): void {
    this._socket.connect();

    this._socket.badgeUpdated$.subscribe((payload) => {
      if (typeof payload.unreadCount === 'number') {
        this._unreadRequestId++;
        this.unreadCount.set(payload.unreadCount);
      } else {
        this.refreshUnreadCount();
      }
      this._applyBadge(payload);
      if (payload.lastMessage?.senderName && payload.lastMessage?.body) {
        this._toast.info(`${payload.lastMessage.senderName}: ${payload.lastMessage.body}`);
      }
    });

    this._socket.messageReceived$.subscribe((message) => {
      this._applyMessage(message);
      this.refreshUnreadCount();
    });

    this._socket.statusUpdated$.subscribe((payload) => this._applyStatus(payload));
    this._socket.reconnected$.subscribe(() => {
      this._requestInboxRefresh();
      this.refreshUnreadCount();
    });

    this._socket.staffDeactivated$.subscribe(() => {
      this.clear();
      this._toast.error('Your account access has changed.');
      this._router.navigate(['/']);
    });
  }

  clear(): void {
    this._session++;
    this._unreadRequestId++;
    this._socket.disconnect();
    this._inboxes.clear();
    this._conversations.clear();
    this._threads.forEach((thread) => {
      thread.messages().forEach((message) => this._releaseAudioUrl(message));
      thread.messages.set([]);
    });
    this._threads.clear();
    this._historyRequests.clear();
    this.unreadCount.set(0);
  }

  messagesFor(conversationId: string): WritableSignal<ConversationMessageDto[]> {
    return this._thread(conversationId).messages;
  }

  activateConversation(conversationId: string): WritableSignal<ConversationMessageDto[]> {
    const thread = this._thread(conversationId);
    thread.active = true;
    return thread.messages;
  }

  deactivateConversation(conversationId: string): void {
    const thread = this._threads.get(conversationId);
    if (thread) {
      thread.active = false;
      this._trimThread(thread);
      this._evictThreads();
    }
  }

  cachedHistory(conversationId: string): { hasMore: boolean } | undefined {
    const history = this._threads.get(conversationId)?.history;
    return history ? { hasMore: history.hasMore } : undefined;
  }

  cachedConversation(conversationId: string): ConversationItemDto | undefined {
    return this._conversations.get(conversationId)?.value;
  }

  private _thread(id: string): ThreadState {
    const thread = this._threads.get(id) ?? {
      messages: signal<ConversationMessageDto[]>([]),
      receipts: new Map(),
      active: false,
      pending: 0,
    };
    this._threads.delete(id);
    this._threads.set(id, thread);
    this._evictThreads(id);
    return thread;
  }

  private _trimThread(thread: ThreadState): void {
    if (thread.active || thread.pending) return;
    const messages = thread.messages();
    const saved = messages.filter((message) => message.status !== 'PENDING');
    if (saved.length > MAX_CACHED_MESSAGES) {
      const retained = new Set(saved.slice(-MAX_CACHED_MESSAGES));
      messages
        .filter((message) => message.status !== 'PENDING' && !retained.has(message))
        .forEach((message) => this._releaseAudioUrl(message));
      thread.messages.set(
        messages.filter((message) => message.status === 'PENDING' || retained.has(message)),
      );
      if (thread.history) thread.history.hasMore = true;
    }
  }

  private _evictThreads(protectedId?: string): void {
    for (const [id, thread] of this._threads) {
      if (this._threads.size <= MAX_CACHED_THREADS) break;
      if (
        id !== protectedId &&
        !thread.active &&
        !thread.pending &&
        !thread.messages().some((message) => message.status === 'PENDING')
      ) {
        thread.messages().forEach((message) => this._releaseAudioUrl(message));
        this._threads.delete(id);
      }
    }
  }

  removePendingMessage(conversationId: string, clientMessageId: string): void {
    const thread = this._threads.get(conversationId);
    if (!thread) return;
    thread.messages.update((messages) =>
      messages.filter((message) => {
        if (message.clientMessageId !== clientMessageId || message.status !== 'PENDING')
          return true;
        this._releaseAudioUrl(message);
        return false;
      }),
    );
    this._evictThreads();
  }

  private _releaseAudioUrl(message: ConversationMessageDto): void {
    if (message.mediaUrl?.startsWith('blob:')) URL.revokeObjectURL(message.mediaUrl);
  }

  private _remember(conversation: ConversationItemDto, revision: number): void {
    this._conversations.delete(conversation.id);
    this._conversations.set(conversation.id, { value: conversation, revision });
    if (this._conversations.size > 1000)
      this._conversations.delete(this._conversations.keys().next().value!);
  }

  cachedCustomerConversations(page = 1, limit = 50, q?: string): Inbox | undefined {
    return this._inboxes.peek(JSON.stringify(['my', page, limit, q?.trim() || '']));
  }

  cachedSalonConversations(
    salonId: string,
    page = 1,
    limit = 50,
    staffId?: string,
    q?: string,
  ): Inbox | undefined {
    return this._inboxes.peek(
      JSON.stringify(['salon', salonId, page, limit, staffId || '', q?.trim() || '']),
    );
  }

  rememberConversation(conversation: ConversationItemDto): void {
    this._patchConversation(conversation.id, () => conversation, conversation);
  }

  private _loadInbox(
    key: string,
    query: InboxQuery,
    fetch: () => Observable<Inbox>,
  ): Observable<Inbox> {
    this._socket.connect();
    return this._inboxes.get(key, () =>
      defer(() => {
        const revision = this._revision;
        const session = this._session;
        const invalidation = this._inboxInvalidation;
        return fetch().pipe(
          filter(() => session === this._session),
          map((result) => {
            const ids = new Set(result.data.map((conversation) => conversation.id));
            const liveRows =
              this._inboxes
                .peek(key)
                ?.data.filter(
                  (conversation) =>
                    !ids.has(conversation.id) &&
                    (this._conversations.get(conversation.id)?.revision ?? 0) > revision,
                ) ?? [];
            return {
              ...result,
              query,
              data: [...result.data, ...liveRows]
                .map((conversation) => {
                  const current = this._conversations.get(conversation.id);
                  if (current && current.revision > revision) return current.value;
                  this._remember(conversation, revision);
                  return conversation;
                })
                .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')),
            };
          }),
          finalize(() => {
            // A new-thread badge or reconnect can arrive while this request
            // still represents the earlier snapshot. Reconcile once more.
            if (session === this._session && invalidation !== this._inboxInvalidation) {
              this.inboxRefresh$.next();
            }
          }),
        );
      }),
    );
  }

  private _patchConversation(
    id: string,
    update: (conversation: ConversationItemDto) => ConversationItemDto,
    fallback?: ConversationItemDto,
  ): void {
    const current = this.cachedConversation(id) ?? fallback;
    if (!current) return;
    const updated = update(current);
    if (updated === current && !fallback) return;
    this._remember(updated, ++this._revision);
    for (const [key, inbox] of [...this._inboxes.entries()]) {
      let data = inbox.data;
      if (!data.some((conversation) => conversation.id === id)) {
        if (!fallback) continue;
        const query = inbox.query;
        const matches =
          query.page === 1 &&
          !query.q &&
          (query.salonId
            ? updated.salonId === query.salonId &&
              (!query.staffId || query.staffId === updated.staffId)
            : updated.customerId === this._user.user()?.id);
        if (!matches) continue;
        data = [updated, ...data];
      }
      this._inboxes.set(key, {
        ...inbox,
        meta: {
          ...inbox.meta,
          total: inbox.meta.total + (data.length > inbox.data.length ? 1 : 0),
          totalPages: Math.ceil(
            (inbox.meta.total + (data.length > inbox.data.length ? 1 : 0)) / inbox.query.limit,
          ),
        },
        data: data
          .map((conversation) => (conversation.id === id ? updated : conversation))
          .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''))
          .slice(0, inbox.query.limit),
      });
    }
    this.inboxUpdated$.next();
  }

  private _mergeMessages(id: string, incoming: ConversationMessageDto[]): void {
    const state = this.messagesFor(id);
    const messages = [...state()];
    for (const message of incoming) {
      const index = messages.findIndex(
        (item) =>
          item.id === message.id ||
          (!!message.clientMessageId && item.clientMessageId === message.clientMessageId),
      );
      if (index < 0) {
        messages.push(message);
      } else {
        const previous = messages[index];
        if (previous.mediaUrl !== message.mediaUrl) this._releaseAudioUrl(previous);
        const newerStatus = STATUS_ORDER[previous.status] > STATUS_ORDER[message.status];
        messages[index] = {
          ...previous,
          ...message,
          status: newerStatus ? previous.status : message.status,
          deliveredAt: message.deliveredAt ?? previous.deliveredAt,
          readAt: message.readAt ?? previous.readAt,
        };
      }
    }
    state.set(
      messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    );
    const thread = this._thread(id);
    thread.receipts.forEach((receipt) => this._applyStatus(receipt, false));
    this._trimThread(thread);
  }

  private _applyMessage(message: ConversationMessageDto): void {
    const thread = this._thread(message.conversationId);
    const alreadyReceived = thread
      .messages()
      .some(
        (item) =>
          item.id === message.id ||
          (item.status !== 'PENDING' && item.clientMessageId === message.clientMessageId),
      );
    this._mergeMessages(message.conversationId, [message]);
    message = thread.messages().find((item) => item.id === message.id) ?? message;
    this._patchConversation(message.conversationId, (conversation) => {
      if ((conversation.lastMessageAt || '') > message.createdAt) return conversation;
      const duplicate = alreadyReceived || conversation.lastMessage?.id === message.id;
      const mine = message.senderUserId === this._user.user()?.id;
      const status =
        conversation.lastMessage?.id === message.id &&
        STATUS_ORDER[conversation.lastMessage.status] > STATUS_ORDER[message.status]
          ? conversation.lastMessage.status
          : message.status;
      return {
        ...conversation,
        lastMessageAt: message.createdAt,
        lastMessage: { ...message, status: status === 'PENDING' ? 'SENT' : status },
        unreadCount: conversation.unreadCount + (!mine && !duplicate && !thread.active ? 1 : 0),
      };
    });
  }

  private _applyBadge(payload: InboxBadgeUpdatedPayload): void {
    const id = payload.conversationId;
    const last = payload.lastMessage;
    if (!id || !last?.createdAt) return;
    // Badges cannot establish exact unread counts or ownership of checkmarks.
    // Render their preview immediately and quietly reconcile server metadata.
    this._requestInboxRefresh();
    if (!this._conversations.has(id)) {
      // Badges lack participant metadata: resolve a newly-created thread once.
      return;
    }
    this._patchConversation(id, (conversation) => {
      if ((conversation.lastMessageAt || '') >= last.createdAt!) return conversation;
      return {
        ...conversation,
        lastMessageAt: last.createdAt!,
        lastMessage: {
          body: last.body || '',
          createdAt: last.createdAt!,
          mediaDurationSeconds: last.mediaDurationSeconds,
          status: 'SENT',
        },
        unreadCount: conversation.unreadCount + 1,
      };
    });
  }

  private _requestInboxRefresh(): void {
    this._inboxInvalidation++;
    this.inboxRefresh$.next();
  }

  private _applyStatus(payload: MessageStatusUpdatedPayload, remember = true): void {
    if (remember) {
      const key = payload.messageId || payload.clientMessageId || payload.upToMessageId;
      if (key) {
        const receipts = this._thread(payload.conversationId).receipts;
        const previous = receipts.get(key);
        if (previous && STATUS_ORDER[previous.status] > STATUS_ORDER[payload.status]) return;
        receipts.set(key, payload);
        if (receipts.size > MAX_CACHED_MESSAGES) receipts.delete(receipts.keys().next().value!);
      }
    }
    const state = this._threads.get(payload.conversationId)?.messages;
    const messages = state?.() ?? [];
    const upToIndex = payload.upToMessageId
      ? messages.findIndex((message) => message.id === payload.upToMessageId)
      : -1;
    const matches = (message: ConversationMessageDto, index: number) =>
      message.id === payload.messageId ||
      (!!payload.clientMessageId && message.clientMessageId === payload.clientMessageId) ||
      (upToIndex >= 0 && index <= upToIndex && message.senderUserId !== payload.readerUserId);
    state?.set(
      messages.map((message, index) =>
        matches(message, index) && STATUS_ORDER[payload.status] >= STATUS_ORDER[message.status]
          ? {
              ...message,
              status: payload.status,
              readAt: payload.readAt ?? message.readAt,
              deliveredAt: payload.deliveredAt ?? message.deliveredAt,
            }
          : message,
      ),
    );
    this._patchConversation(payload.conversationId, (conversation) => {
      const last = conversation.lastMessage;
      const updated = state?.().find((message) => message.id === last?.id);
      const status =
        updated?.status ??
        (last && (last.id === payload.messageId || last.id === payload.upToMessageId)
          ? payload.status
          : undefined);
      if (
        !last ||
        !status ||
        status === 'PENDING' ||
        STATUS_ORDER[status] < STATUS_ORDER[last.status]
      )
        return conversation;
      const readLatest =
        payload.status === 'READ' &&
        payload.readerUserId === this._user.user()?.id &&
        !!last.id &&
        (last.id === payload.upToMessageId || last.id === payload.messageId);
      return {
        ...conversation,
        lastMessage: { ...last, status },
        unreadCount: readLatest ? 0 : conversation.unreadCount,
      };
    });
  }

  refreshUnreadCount(): void {
    this.getUnreadCount().subscribe({ error: () => {} });
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
    return defer(() => {
      const session = this._session;
      const requestId = ++this._unreadRequestId;
      return customerChatControllerGetUnreadCount(this._http, this._apiConfig.rootUrl, {}).pipe(
        filter(() => session === this._session && requestId === this._unreadRequestId),
        map((res) => res.body),
        tap((res) => this.unreadCount.set(res.unreadCount)),
      );
    });
  }

  // ── 4.3 Customer Inbox List ────────────────────────────────────────────────
  getCustomerConversations(page = 1, limit = 50, q?: string): Observable<Inbox> {
    const key = JSON.stringify(['my', page, limit, q?.trim() || '']);
    return this._loadInbox(key, { page, limit, q: q?.trim() || undefined }, () =>
      customerChatControllerListMyConversations(this._http, this._apiConfig.rootUrl, {
        page,
        limit,
        q: q?.trim() || undefined,
      }).pipe(
        map((res) => ({
          data: res.body.data ?? [],
          meta: res.body.meta ?? { page, limit, total: 0, totalPages: 1 },
        })),
      ),
    );
  }

  // ── 4.4 Salon Inbox List ───────────────────────────────────────────────────
  getSalonConversations(
    salonId: string,
    page = 1,
    limit = 50,
    staffId?: string,
    q?: string,
  ): Observable<Inbox> {
    const key = JSON.stringify(['salon', salonId, page, limit, staffId || '', q?.trim() || '']);
    return this._loadInbox(key, { salonId, staffId, page, limit, q: q?.trim() || undefined }, () =>
      salonChatControllerListSalonConversations(this._http, this._apiConfig.rootUrl, {
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
      ),
    );
  }

  // ── 4.5 Create / Open Conversation (Idempotent) ────────────────────────────
  createOrOpenConversation(
    salonId: string,
    staffId?: string,
    metadata?: {
      customerId?: string;
      salonName?: string;
      staffName?: string;
      customerName?: string;
    },
  ): Observable<ConversationItemDto> {
    const body: CreateConversationDto = {};
    if (staffId) body.staffId = staffId;
    if (metadata?.customerId) body.customerId = metadata.customerId;

    const session = this._session;
    return salonChatControllerOpenConversation(this._http, this._apiConfig.rootUrl, {
      salonId,
      body,
    }).pipe(
      filter(() => session === this._session),
      map((res) => res.body),
      tap((conversation) => this.rememberConversation(conversation)),
    );
  }

  // ── 4.6 Message History (Keyset Pagination) ────────────────────────────────
  getMessageHistory(
    conversationId: string,
    before?: string,
    limit = 50,
  ): Observable<MessageHistoryResponseDto> {
    return defer(() => this._loadHistory(conversationId, before, limit));
  }

  private _loadHistory(
    conversationId: string,
    before: string | undefined,
    limit: number,
  ): Observable<MessageHistoryResponseDto> {
    const key = JSON.stringify([conversationId, before || '', limit]);
    const pending = this._historyRequests.get(key);
    if (pending) return pending;
    const session = this._session;
    const thread = this._thread(conversationId);
    thread.pending++;
    const lastKnown = !before ? thread.history?.anchor : undefined;
    const fetchPage = (cursor?: string) =>
      customerChatControllerGetMessages(this._http, this._apiConfig.rootUrl, {
        id: conversationId,
        before: cursor,
        limit,
      }).pipe(
        filter(() => session === this._session),
        map(
          (res): MessageHistoryResponseDto => ({
            data: (res.body.data ?? []) as ConversationMessageDto[],
            hasMore: res.body.hasMore ?? false,
          }),
        ),
      );
    const request$ = fetchPage(before).pipe(
      // A reconnect may have missed more than one page. Fetch backwards until
      // the new history meets the cached history, keeping cached content visible.
      expand((res) => {
        const page = res.data;
        const oldest = page.at(-1);
        const overlaps = lastKnown && page.some((message) => message.id === lastKnown.id);
        return lastKnown &&
          res.hasMore &&
          oldest &&
          !overlaps &&
          oldest.createdAt >= lastKnown.createdAt
          ? fetchPage(oldest.id)
          : EMPTY;
      }),
      reduce((combined, res) => ({
        ...res,
        data: [...combined.data, ...res.data],
      })),
      filter(() => session === this._session),
      map((res) => {
        const messages = res.data;
        const current = this.messagesFor(conversationId);
        const previousOldest = current()[0];
        this._mergeMessages(conversationId, messages);
        // A refresh of the newest page must preserve already-loaded older pages.
        const fetchedOldest = messages[messages.length - 1];
        if (
          before ||
          !thread.history ||
          !previousOldest ||
          !fetchedOldest ||
          previousOldest.createdAt >= fetchedOldest.createdAt
        ) {
          thread.history = { ...thread.history, hasMore: res.hasMore };
        }
        if (!before && messages[0]) thread.history!.anchor = messages[0];
        return {
          data: [...current()].reverse(),
          hasMore: thread.history?.hasMore ?? false,
        };
      }),
      finalize(() => {
        if (this._historyRequests.get(key) === request$) this._historyRequests.delete(key);
        thread.pending--;
        this._trimThread(thread);
        this._evictThreads();
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this._historyRequests.set(key, request$);
    return request$;
  }

  // ── 4.7 Send Message ───────────────────────────────────────────────────────
  sendMessage(conversationId: string, payload: SendMessageDto): Observable<ConversationMessageDto> {
    const session = this._session;
    return customerChatControllerSendMessage(this._http, this._apiConfig.rootUrl, {
      id: conversationId,
      body: {
        clientMessageId: payload.clientMessageId,
        body: payload.body,
        mediaUrl: payload.mediaUrl ?? undefined,
        mediaDurationSeconds: payload.mediaDurationSeconds ?? undefined,
      },
    }).pipe(
      filter(() => session === this._session),
      map((res) => res.body as ConversationMessageDto),
      tap((message) => this._applyMessage(message)),
    );
  }

  // ── 4.8 Mark Messages as Read ──────────────────────────────────────────────
  markAsRead(conversationId: string, upToMessageId?: string): Observable<void> {
    const session = this._session;
    const readThrough = this.cachedConversation(conversationId)?.lastMessageAt;
    return customerChatControllerMarkAsRead(this._http, this._apiConfig.rootUrl, {
      id: conversationId,
      body: upToMessageId ? { upToMessageId } : {},
    }).pipe(
      filter(() => session === this._session),
      map(() => undefined),
      tap(() => {
        this._patchConversation(conversationId, (conversation) =>
          conversation.lastMessageAt === readThrough
            ? { ...conversation, unreadCount: 0 }
            : conversation,
        );
        this.refreshUnreadCount();
      }),
    );
  }

  // ── 4.9 Salon Broadcast ────────────────────────────────────────────────────
  sendBroadcast(
    salonId: string,
    payload: SalonBroadcastDto,
  ): Observable<SalonBroadcastResponseDto> {
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
    const session = this._session;
    return customerChatControllerBlockConversation(this._http, this._apiConfig.rootUrl, {
      id: conversationId,
    }).pipe(
      filter(() => session === this._session),
      map((res) => res.body),
      tap((conversation) => this.rememberConversation(conversation)),
    );
  }

  unblockConversation(conversationId: string): Observable<ConversationItemDto> {
    const session = this._session;
    return customerChatControllerUnblockConversation(this._http, this._apiConfig.rootUrl, {
      id: conversationId,
    }).pipe(
      filter(() => session === this._session),
      map((res) => res.body),
      tap((conversation) => this.rememberConversation(conversation)),
    );
  }
}
