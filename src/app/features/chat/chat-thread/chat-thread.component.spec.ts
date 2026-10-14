import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { ChatService } from '../../../core/chat/chat.service';
import { ChatSocketService } from '../../../core/chat/chat-socket.service';
import { ConversationItemDto, ConversationMessageDto } from '../../../core/chat/chat.types';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { ToastService } from '../../../core/toast/toast.service';
import { ChatThreadComponent } from './chat-thread.component';

const conversation = (id: string): ConversationItemDto => ({
  id,
  customerId: 'me',
  customerName: 'Customer',
  salonId: 'salon',
  salonName: 'Salon',
  salonSlug: '',
  isSalonGeneral: true,
  status: 'ACTIVE',
  type: 'DIRECT',
  unreadCount: 0,
  createdAt: '2026-10-14T10:00:00Z',
});
const message = (id: string): ConversationMessageDto => ({
  id: `message-${id}`,
  clientMessageId: `client-${id}`,
  conversationId: id,
  senderUserId: 'me',
  senderRole: 'CUSTOMER',
  senderDisplayName: 'Me',
  body: `Message for ${id}`,
  status: 'SENT',
  isBroadcast: false,
  createdAt: '2026-10-14T10:00:00Z',
});

describe('ChatThreadComponent route and cache integration', () => {
  let http: HttpTestingController;
  let service: ChatService;
  let incoming: Subject<ConversationMessageDto>;
  let socket: {
    joinConversation: ReturnType<typeof vi.fn>;
    leaveConversation: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    incoming = new Subject();
    socket = { joinConversation: vi.fn(), leaveConversation: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'chat/:conversationId', component: ChatThreadComponent }]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ApiConfiguration, useValue: { rootUrl: '' } },
        {
          provide: CurrentUserStore,
          useValue: { user: () => ({ id: 'me', firstName: 'Me', lastName: '' }) },
        },
        {
          provide: SalonContextService,
          useValue: { activeSalonId: () => null, displaySalonId: () => null },
        },
        { provide: SalonsStore, useValue: { salons: () => [] } },
        { provide: ToastService, useValue: { info: vi.fn(), error: vi.fn() } },
        {
          provide: ChatSocketService,
          useValue: {
            ...socket,
            connect: vi.fn(),
            disconnect: vi.fn(),
            stopTyping: vi.fn(),
            startTyping: vi.fn(),
            messageReceived$: incoming,
            statusUpdated$: new Subject(),
            badgeUpdated$: new Subject(),
            reconnected$: new Subject(),
            staffDeactivated$: new Subject(),
            typingIndicator$: new Subject(),
          },
        },
      ],
    });
    service = TestBed.inject(ChatService);
    http = TestBed.inject(HttpTestingController);
    service.rememberConversation(conversation('a'));
    service.rememberConversation(conversation('b'));
  });
  afterEach(() => {
    http.match((request) => request.url.startsWith('/svgs/'))
      .forEach((request) => request.flush('<svg viewBox="0 0 24 24"></svg>'));
    http.verify();
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('switches a reused route component without mixing histories or flashing away cached messages', async () => {
    const harness = await RouterTestingHarness.create();
    const first = await harness.navigateByUrl('/chat/a', ChatThreadComponent);
    const delayed = http.expectOne((request) => request.url.endsWith('/a/messages'));
    const second = await harness.navigateByUrl('/chat/b', ChatThreadComponent);
    expect(second).toBe(first);
    expect(socket.leaveConversation).toHaveBeenCalledWith('a');
    http
      .expectOne((request) => request.url.endsWith('/b/messages'))
      .flush({ data: [message('b')], hasMore: false });
    harness.detectChanges();
    delayed.flush({ data: [message('a')], hasMore: false });
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('Message for b');
    expect(harness.routeNativeElement!.textContent).not.toContain('Message for a');
    expect(service.messagesFor('a')()[0].body).toBe('Message for a');
    await harness.navigateByUrl('/chat/a');
    expect(harness.routeNativeElement!.textContent).toContain('Message for a');
    expect(harness.routeNativeElement!.textContent).not.toContain('Message for b');
    http
      .expectOne((request) => request.url.endsWith('/a/messages'))
      .flush({ data: [message('a')], hasMore: false });
  });

  it('reuses the existing message DOM node when a socket acknowledgement confirms an optimistic send', async () => {
    const harness = await RouterTestingHarness.create('/chat/a');
    http
      .expectOne((request) => request.url.endsWith('/a/messages'))
      .flush({ data: [message('a')], hasMore: false });
    harness.detectChanges();
    const paragraph = [...harness.routeNativeElement!.querySelectorAll('p')].find(
      (node) => node.textContent === 'Message for a',
    );
    incoming.next({ ...message('a'), id: 'confirmed-id', status: 'DELIVERED' });
    http.expectOne((request) => request.url.endsWith('/unread-count')).flush({ unreadCount: 0 });
    harness.detectChanges();
    const updated = [...harness.routeNativeElement!.querySelectorAll('p')].find(
      (node) => node.textContent === 'Message for a',
    );
    expect(updated).toBe(paragraph);
    expect(service.messagesFor('a')()).toHaveLength(1);
    expect(service.messagesFor('a')()[0].status).toBe('DELIVERED');
  });

  it('stops a late microphone permission result after navigating to another conversation', async () => {
    const harness = await RouterTestingHarness.create('/chat/a');
    http
      .expectOne((request) => request.url.endsWith('/a/messages'))
      .flush({ data: [], hasMore: false });
    let grant!: (stream: MediaStream) => void;
    const stop = vi.fn();
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            grant = resolve;
          }),
      },
    });
    try {
      harness.detectChanges();
      (
        harness.routeNativeElement!.querySelector(
          '[title="Record voice note"]',
        ) as HTMLButtonElement
      ).click();
      await harness.navigateByUrl('/chat/b');
      http
        .expectOne((request) => request.url.endsWith('/b/messages'))
        .flush({ data: [], hasMore: false });
      grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
      await Promise.resolve();
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original });
    }
  });

  it('uploads Opus recordings using the signed base MIME and sends their duration', async () => {
    const harness = await RouterTestingHarness.create('/chat/a');
    http
      .expectOne((request) => request.url.endsWith('/a/messages'))
      .flush({ data: [], hasMore: false });
    const original = navigator.mediaDevices;
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }),
      },
    });
    let recorder!: FakeRecorder;
    class FakeRecorder {
      static isTypeSupported(type: string) {
        return type === 'audio/webm;codecs=opus';
      }
      state = 'inactive';
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      constructor() {
        recorder = this;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({
          data: new Blob(['recorded audio'], { type: 'audio/webm;codecs=opus' }),
        });
        this.onstop?.();
      }
    }
    const revoke = vi.fn();
    const NativeURL = URL;
    vi.stubGlobal(
      'URL',
      class extends NativeURL {
        static override createObjectURL() {
          return 'blob:voice-preview';
        }
        static override revokeObjectURL = revoke;
      },
    );
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const upload = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => ({ ok: true }));
    vi.stubGlobal('fetch', upload);
    try {
      harness.detectChanges();
      (
        harness.routeNativeElement!.querySelector(
          '[title="Record voice note"]',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
      expect(recorder.state).toBe('recording');
      harness.detectChanges();
      (
        harness.routeNativeElement!.querySelector('[title="Send voice note"]') as HTMLButtonElement
      ).click();
      const presign = http.expectOne((request) => request.url.endsWith('/media/presign-upload'));
      expect(presign.request.body.contentType).toBe('audio/webm');
      presign.flush({
        uploadUrl: 'https://upload.example/note',
        url: 'https://r2.hairmela.com/note.webm',
        headers: { 'content-type': 'audio/webm' },
        publicId: 'note.webm',
        expiresIn: 1800,
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(new Headers(upload.mock.calls[0][1]!.headers).get('Content-Type')).toBe('audio/webm');
      const sent = http.expectOne(
        (request) => request.method === 'POST' && request.url.endsWith('/a/messages'),
      );
      expect(sent.request.body.mediaDurationSeconds).toBe(1);
      expect(sent.request.body.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
      sent.flush({
        ...message('a'),
        clientMessageId: sent.request.body.clientMessageId,
        mediaUrl: sent.request.body.mediaUrl,
        mediaDurationSeconds: 1,
      });
      expect(revoke).toHaveBeenCalledWith('blob:voice-preview');
      expect(stopTrack).toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original });
    }
  });
});
