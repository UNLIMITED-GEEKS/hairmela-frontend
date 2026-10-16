import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { io } from 'socket.io-client';
import { TokenStore } from '../auth/token.store';
import { AppResumeService } from '../native/app-resume.service';
import { ChatSocketService } from './chat-socket.service';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));

describe('ChatSocketService lifecycle', () => {
  let service: ChatSocketService;
  let token: string | null;
  let resumed: ReturnType<typeof signal<number>>;
  let handlers: Map<string, (...args: unknown[]) => void>;
  let socket: {
    connected: boolean;
    active: boolean;
    emit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.mocked(io).mockReset();
    token = 'initial-token';
    resumed = signal(0);
    handlers = new Map();
    socket = {
      connected: false,
      active: true,
      emit: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) =>
        handlers.set(event, handler),
      ),
      removeAllListeners: vi.fn(() => handlers.clear()),
    };
    vi.mocked(io).mockReturnValue(socket as unknown as ReturnType<typeof io>);
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: TokenStore, useValue: { getAccessToken: () => token } },
        { provide: AppResumeService, useValue: { resumed } },
      ],
    });
    service = TestBed.inject(ChatSocketService);
    service.disconnect();
  });
  afterEach(() => {
    service.ngOnDestroy();
    TestBed.resetTestingModule();
  });

  it('uses the current access token for every handshake and keeps retrying after long outages', () => {
    service.connect();
    const options = vi.mocked(io).mock.calls[0][1]!;
    const auth = options.auth as (callback: (auth: { token: string | null }) => void) => void;
    const callback = vi.fn();
    auth(callback);
    expect(callback).toHaveBeenLastCalledWith({ token: 'initial-token' });
    token = 'refreshed-token';
    auth(callback);
    expect(callback).toHaveBeenLastCalledWith({ token: 'refreshed-token' });
    expect(options.reconnectionAttempts).toBeUndefined();
  });

  it('joins the active conversation once on each connection and does not duplicate a pending connection', () => {
    const reconcile = vi.fn();
    service.reconnected$.subscribe(reconcile);
    service.joinConversation('thread-1');
    service.connect();
    expect(io).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalled();
    socket.connected = true;
    handlers.get('connect')!();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenLastCalledWith(
      'conversation:join',
      { conversationId: 'thread-1' },
      undefined,
    );
    handlers.get('connect')!();
    expect(socket.emit).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('does not replay stale room joins, leaves or typing events after switching chats offline', () => {
    service.joinConversation('thread-1');
    service.startTyping('thread-1');
    service.leaveConversation('thread-1');
    service.joinConversation('thread-2');
    expect(socket.emit).not.toHaveBeenCalled();
    socket.connected = true;
    handlers.get('connect')!();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenLastCalledWith(
      'conversation:join',
      { conversationId: 'thread-2' },
      undefined,
    );
  });

  it('reconciles on foreground and online events, and removes listeners on destroy', () => {
    const reconcile = vi.fn();
    service.reconnected$.subscribe(reconcile);
    resumed.set(1);
    TestBed.tick();
    expect(reconcile).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    expect(reconcile).toHaveBeenCalledTimes(2);
    TestBed.resetTestingModule();
    window.dispatchEvent(new Event('online'));
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(socket.removeAllListeners).toHaveBeenCalled();
  });
});
