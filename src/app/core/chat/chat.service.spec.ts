import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { CurrentUserStore } from '../auth/current-user.store';
import { CacheRegistry } from '../caching/cache-registry/cache-registry.service';
import { ToastService } from '../toast/toast.service';
import { ChatSocketService } from './chat-socket.service';
import { ChatService } from './chat.service';
import {
  ConversationItemDto,
  ConversationMessageDto,
  InboxBadgeUpdatedPayload,
  MessageStatusUpdatedPayload,
} from './chat.types';

const message = (id: string, seconds = 0): ConversationMessageDto => ({
  id,
  clientMessageId: `client-${id}`,
  conversationId: 'thread-1',
  senderUserId: 'barber',
  senderRole: 'STAFF',
  senderDisplayName: 'Barber',
  body: id,
  status: 'SENT',
  isBroadcast: false,
  createdAt: new Date(Date.UTC(2026, 9, 14, 10, 0, seconds)).toISOString(),
});
const conversation = (id = 'thread-1'): ConversationItemDto => ({
  id,
  customerId: 'me',
  customerName: 'Me',
  salonId: 'salon-1',
  salonName: 'Salon',
  salonSlug: 'salon',
  isSalonGeneral: true,
  status: 'ACTIVE',
  type: 'DIRECT',
  unreadCount: 0,
  createdAt: message('old').createdAt,
  lastMessageAt: message('old').createdAt,
  lastMessage: { ...message('old'), status: 'SENT' },
});

describe('ChatService cached state', () => {
  let service: ChatService;
  let http: HttpTestingController;
  let messages: Subject<ConversationMessageDto>;
  let statuses: Subject<MessageStatusUpdatedPayload>;
  let badges: Subject<InboxBadgeUpdatedPayload>;
  let reconnect: Subject<void>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    messages = new Subject();
    statuses = new Subject();
    badges = new Subject();
    reconnect = new Subject();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ApiConfiguration, useValue: { rootUrl: '' } },
        { provide: CurrentUserStore, useValue: { user: () => ({ id: 'me' }) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ToastService, useValue: { info: vi.fn(), error: vi.fn() } },
        {
          provide: ChatSocketService,
          useValue: {
            connect: vi.fn(),
            disconnect: vi.fn(),
            messageReceived$: messages,
            statusUpdated$: statuses,
            badgeUpdated$: badges,
            reconnected$: reconnect,
            staffDeactivated$: new Subject(),
          },
        },
      ],
    });
    service = TestBed.inject(ChatService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function loadInbox(): void {
    service.getCustomerConversations(1, 100).subscribe();
    http
      .expectOne((request) => request.url === '/v1/conversations')
      .flush({ data: [conversation()] });
  }

  function flushUnread(): void {
    http
      .match((request) => request.url.endsWith('/unread-count'))
      .forEach((request) => request.flush({ unreadCount: 1 }));
  }

  it('bounds inactive histories while preserving an active conversation and pending sends', () => {
    const active = service.activateConversation('active');
    active.set([message('active-message')]);
    const pending = service.messagesFor('pending');
    pending.set([{ ...message('pending-message'), status: 'PENDING' }]);
    const discarded = service.messagesFor('discarded');
    discarded.set([message('old')]);
    for (let index = 0; index < 55; index++) service.messagesFor(`other-${index}`);
    expect(service.messagesFor('active')).toBe(active);
    expect(service.messagesFor('pending')).toBe(pending);
    expect(service.messagesFor('discarded')).not.toBe(discarded);
    expect(active()).toHaveLength(1);
    expect(pending()).toHaveLength(1);
  });

  it('keeps full history while viewed, trims it on leaving, and allows older pages to load again', () => {
    const state = service.activateConversation('thread-1');
    service.getMessageHistory('thread-1').subscribe();
    const history = Array.from({ length: 220 }, (_, index) => message(`message-${index}`, index));
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [...history].reverse(), hasMore: false });
    expect(state()).toHaveLength(220);
    service.deactivateConversation('thread-1');
    expect(state()).toHaveLength(200);
    expect(state()[0].id).toBe('message-20');
    expect(service.cachedHistory('thread-1')).toEqual({ hasMore: true });
    service.activateConversation('thread-1');
    service.getMessageHistory('thread-1', 'message-20').subscribe();
    http
      .expectOne((request) => request.params.get('before') === 'message-20')
      .flush({ data: history.slice(0, 20).reverse(), hasMore: false });
    expect(state()).toHaveLength(220);
  });

  it('does not let an older unread-count response overwrite a newer response or badge', () => {
    service.getUnreadCount().subscribe();
    service.getUnreadCount().subscribe();
    const requests = http.match((request) => request.url.endsWith('/unread-count'));
    requests[1].flush({ unreadCount: 2 });
    requests[0].flush({ unreadCount: 8 });
    expect(service.unreadCount()).toBe(2);
    service.getUnreadCount().subscribe();
    const old = http.expectOne((request) => request.url.endsWith('/unread-count'));
    badges.next({ unreadCount: 3 });
    old.flush({ unreadCount: 1 });
    expect(service.unreadCount()).toBe(3);
  });

  it('preserves a newer unread message when an older mark-read response arrives', () => {
    loadInbox();
    service.markAsRead('thread-1').subscribe();
    messages.next(message('new', 20));
    http
      .expectOne((request) => request.method === 'PATCH' && request.url.includes('thread-1'))
      .flush({});
    expect(service.cachedConversation('thread-1')?.unreadCount).toBe(1);
    flushUnread();
  });

  it('counts distinct messages with identical timestamps separately', () => {
    loadInbox();
    messages.next(message('first', 20));
    messages.next(message('second', 20));
    messages.next(message('second', 20));
    expect(service.cachedConversation('thread-1')?.unreadCount).toBe(2);
    flushUnread();
  });

  it('removes failed pending messages without removing a message already confirmed by a socket', () => {
    const state = service.messagesFor('thread-1');
    state.set([{ ...message('pending'), status: 'PENDING' }]);
    service.removePendingMessage('thread-1', 'client-pending');
    expect(state()).toEqual([]);
    messages.next(message('saved'));
    service.removePendingMessage('thread-1', 'client-saved');
    expect(state().map((item) => item.id)).toEqual(['saved']);
    flushUnread();
  });

  it('renders cached inbox data immediately and refreshes quietly with a shared request', () => {
    loadInbox();
    const results: ConversationItemDto[][] = [];
    service.getCustomerConversations(1, 100).subscribe((result) => results.push(result.data));
    service.getCustomerConversations(1, 100).subscribe();
    expect(results).toEqual([[conversation()]]);
    http
      .expectOne((request) => request.url === '/v1/conversations')
      .flush({ data: [{ ...conversation(), customerName: 'Updated' }] });
    expect(results[1][0].customerName).toBe('Updated');
  });

  it('patches messages, previews, ordering and unread counts from sockets without fetching inboxes', () => {
    loadInbox();
    messages.next(message('new', 20));
    messages.next(message('new', 20));
    const cached = service.cachedCustomerConversations(1, 100)!.data[0];
    expect(cached.lastMessage?.body).toBe('new');
    expect(cached.unreadCount).toBe(1);
    expect(
      service
        .messagesFor('thread-1')()
        .map((item) => item.id),
    ).toEqual(['new']);
    http.expectNone((request) => request.url === '/v1/conversations');
    flushUnread();
  });

  it('keeps a socket message and its read receipt when an older history response arrives', () => {
    service.getMessageHistory('thread-1').subscribe();
    const pending = http.expectOne((request) => request.url.endsWith('/messages'));
    messages.next(message('new', 20));
    statuses.next({ conversationId: 'thread-1', messageId: 'new', status: 'READ' });
    pending.flush({ data: [message('new', 20), message('old')], hasMore: false });
    expect(
      service
        .messagesFor('thread-1')()
        .map((item) => item.id),
    ).toEqual(['old', 'new']);
    expect(service.messagesFor('thread-1')()[1].status).toBe('READ');
    flushUnread();
  });

  it('preserves receipts received before history has loaded', () => {
    service.getMessageHistory('thread-1').subscribe();
    statuses.next({
      conversationId: 'thread-1',
      upToMessageId: 'old',
      status: 'READ',
      readerUserId: 'me',
    });
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [message('old')], hasMore: false });
    expect(service.messagesFor('thread-1')()[0].status).toBe('READ');
  });

  it('keeps loaded older pages and the same message signal when reopening a conversation', () => {
    const state = service.messagesFor('thread-1');
    service.getMessageHistory('thread-1').subscribe();
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [message('new', 20)], hasMore: true });
    service.getMessageHistory('thread-1', 'new').subscribe();
    http
      .expectOne((request) => request.params.get('before') === 'new')
      .flush({ data: [message('old')], hasMore: false });
    service.getMessageHistory('thread-1').subscribe();
    expect(service.cachedHistory('thread-1')).toEqual({ hasMore: false });
    expect(service.messagesFor('thread-1')).toBe(state);
    expect(state().length).toBe(2);
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [message('new', 20)], hasMore: true });
    expect(state().length).toBe(2);
    expect(service.cachedHistory('thread-1')).toEqual({ hasMore: false });
  });

  it('keeps conversations isolated when switching back, receiving live updates, and resolving late requests', () => {
    const first = service.messagesFor('thread-1');
    const second = service.messagesFor('thread-2');
    const firstMessage = message('first');
    const secondMessage = { ...message('second'), conversationId: 'thread-2' };
    service.getMessageHistory('thread-1').subscribe();
    const delayed = http.expectOne((request) => request.url.includes('/thread-1/messages'));
    service.getMessageHistory('thread-2').subscribe();
    http
      .expectOne((request) => request.url.includes('/thread-2/messages'))
      .flush({ data: [secondMessage], hasMore: false });
    delayed.flush({ data: [firstMessage], hasMore: true });
    expect(first()).toEqual([firstMessage]);
    expect(second()).toEqual([secondMessage]);

    messages.next(message('new-first', 20));
    statuses.next({ conversationId: 'thread-1', messageId: 'new-first', status: 'READ' });
    flushUnread();
    expect(second()).toEqual([secondMessage]);
    expect(service.cachedHistory('thread-1')).toEqual({ hasMore: true });
    expect(service.cachedHistory('thread-2')).toEqual({ hasMore: false });

    service.getMessageHistory('thread-1').subscribe();
    expect(service.messagesFor('thread-1')).toBe(first);
    expect(first().map((item) => item.id)).toEqual(['first', 'new-first']);
    http
      .expectOne((request) => request.url.includes('/thread-1/messages'))
      .flush({ data: [message('new-first', 20), firstMessage], hasMore: true });
    expect(first()[1].status).toBe('READ');
    expect(service.messagesFor('thread-2')).toBe(second);
    expect(second()).toEqual([secondMessage]);
  });

  it('fetches missed history pages back to the last known message without blanking the cache', () => {
    service.getMessageHistory('thread-1').subscribe();
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [message('old')], hasMore: false });
    const state = service.messagesFor('thread-1');
    service.getMessageHistory('thread-1').subscribe();
    expect(state().map((item) => item.id)).toEqual(['old']);
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [message('latest', 60), message('page-boundary', 50)], hasMore: true });
    expect(state().map((item) => item.id)).toEqual(['old']);
    http
      .expectOne((request) => request.params.get('before') === 'page-boundary')
      .flush({ data: [message('missed', 30), message('old')], hasMore: false });
    expect(state().map((item) => item.id)).toEqual(['old', 'missed', 'page-boundary', 'latest']);
    expect(service.cachedHistory('thread-1')).toEqual({ hasMore: false });
  });

  it('still fills an offline gap after a catch-up fails and a newer socket message arrives', () => {
    service.getMessageHistory('thread-1').subscribe();
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [message('old')], hasMore: false });
    service.getMessageHistory('thread-1').subscribe({ error: () => {} });
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [message('latest', 60)], hasMore: true });
    http
      .expectOne((request) => request.params.get('before') === 'latest')
      .flush({}, { status: 503, statusText: 'Offline' });
    messages.next(message('socket', 70));
    flushUnread();
    service.getMessageHistory('thread-1').subscribe();
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [message('socket', 70), message('latest', 60)], hasMore: true });
    http
      .expectOne((request) => request.params.get('before') === 'latest')
      .flush({ data: [message('missed', 30), message('old')], hasMore: false });
    expect(
      service
        .messagesFor('thread-1')()
        .map((item) => item.id),
    ).toEqual(['old', 'missed', 'latest', 'socket']);
  });

  it('requests another reconciliation when a new-thread badge arrives during an inbox fetch', () => {
    const refresh = vi.fn();
    service.inboxRefresh$.subscribe(refresh);
    service.getCustomerConversations(1, 100).subscribe();
    badges.next({
      conversationId: 'thread-2',
      unreadCount: 1,
      lastMessage: { body: 'Hello', createdAt: message('new', 20).createdAt },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    http
      .expectOne((request) => request.url === '/v1/conversations')
      .flush({ data: [conversation()] });
    expect(refresh).toHaveBeenCalledTimes(2);
    service.getCustomerConversations(1, 100).subscribe();
    http
      .expectOne((request) => request.url === '/v1/conversations')
      .flush({ data: [conversation('thread-2'), conversation()] });
    expect(service.cachedCustomerConversations(1, 100)!.data.map((item) => item.id)).toContain(
      'thread-2',
    );
  });

  it('patches known voice-note badges once and preserves a newer badge during background refresh', () => {
    loadInbox();
    service.getCustomerConversations(1, 100).subscribe();
    const badge = {
      conversationId: 'thread-1',
      unreadCount: 1,
      lastMessage: {
        body: '🎤 Voice message (0:24)',
        mediaDurationSeconds: 24,
        createdAt: message('new', 20).createdAt,
      },
    };
    badges.next(badge);
    badges.next(badge);
    http
      .expectOne((request) => request.url === '/v1/conversations')
      .flush({ data: [conversation()] });
    const cached = service.cachedCustomerConversations(1, 100)!.data[0];
    expect(cached.lastMessage?.mediaDurationSeconds).toBe(24);
    expect(cached.lastMessage?.body).toBe('🎤 Voice message (0:24)');
    expect(cached.unreadCount).toBe(1);
  });

  it('reconciles optimistic voice notes by nonce and includes their duration in the send request', () => {
    const optimistic = { ...message('optimistic'), status: 'PENDING' as const, senderUserId: 'me' };
    service.messagesFor('thread-1').set([optimistic]);
    service
      .sendMessage('thread-1', {
        clientMessageId: optimistic.clientMessageId,
        body: '',
        mediaUrl: 'https://r2.hairmela.com/note.webm',
        mediaDurationSeconds: 24,
      })
      .subscribe();
    const request = http.expectOne((req) => req.url.endsWith('/messages'));
    expect(request.request.body.mediaDurationSeconds).toBe(24);
    messages.next({ ...optimistic, id: 'saved', status: 'SENT' });
    statuses.next({ conversationId: 'thread-1', messageId: 'saved', status: 'READ' });
    request.flush({ ...optimistic, id: 'saved', status: 'SENT' });
    expect(service.messagesFor('thread-1')()).toEqual([
      expect.objectContaining({ id: 'saved', status: 'READ' }),
    ]);
    flushUnread();
  });

  it('clears private data on logout and ignores old requests that finish afterwards', () => {
    loadInbox();
    const state = service.messagesFor('thread-1');
    state.set([message('old')]);
    service.getMessageHistory('thread-1').subscribe();
    service.getCustomerConversations(1, 100).subscribe();
    TestBed.inject(CacheRegistry).clearAll();
    http
      .expectOne((request) => request.url.endsWith('/messages'))
      .flush({ data: [message('new')] });
    http
      .expectOne((request) => request.url === '/v1/conversations')
      .flush({ data: [conversation()] });
    expect(state()).toEqual([]);
    expect(service.cachedCustomerConversations(1, 100)).toBeUndefined();
    expect(service.cachedConversation('thread-1')).toBeUndefined();
    expect(service.cachedHistory('thread-1')).toBeUndefined();
  });

  it('adds an opened conversation immediately and keeps it if a stale inbox response omits it', () => {
    loadInbox();
    service.getCustomerConversations(1, 100).subscribe();
    service.rememberConversation(conversation('thread-2'));
    expect(service.cachedCustomerConversations(1, 100)!.data.map((item) => item.id)).toContain(
      'thread-2',
    );
    http
      .expectOne((request) => request.url === '/v1/conversations')
      .flush({ data: [conversation()] });
    expect(service.cachedCustomerConversations(1, 100)!.data.map((item) => item.id)).toContain(
      'thread-2',
    );
  });
});
