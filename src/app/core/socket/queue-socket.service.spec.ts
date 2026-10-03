import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Subject } from 'rxjs';
import { QueueSocketService } from './queue-socket.service';
import { PayloadEncryptionService } from '../payload-encryption/payload-encryption.service';

// Fakes socket.io-client's io() so watch/unwatch refcounting can be tested
// without a real network connection. connect() only wires listeners and
// stores this fake — none of the tests below need 'connect' to actually
// fire, since watchQueueAsStaff/unwatchQueue only touch the socket when
// `this._socket?.connected` is true.
const fakeSocket = {
  connected: true,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

const fakeEncryption = {
  sessionChanged$: new Subject<void>(),
  socketSessionIsCurrent: () => true,
  ensureSession: async () => null,
  invalidate: vi.fn(),
  encryptSocket: async () => null,
  decryptSocket: async <T>(_event: string, payload: T) => payload,
};

// FIXME: this spec fails intermittently (~1 run in 6) in the FULL suite, while
// passing every time in isolation. Failures show as "Number of calls: 0" on
// fakeSocket.emit across most tests at once, which means connect() stored a
// REAL socket.io client instead of the fake below — i.e. this vi.mock did not
// apply for that run.
//
// vi.mock is hoisted and module-scoped: whichever spec file loads
// socket.io-client FIRST in a shared Vitest worker wins for the whole worker.
// Any other spec that transitively imports QueueSocketService (via
// SalonVisitService, for instance) can therefore win the race and leave this
// file's mock inert. Declaring the same mock in the other file was tried and
// did not fix it.
//
// The service itself is not suspected — only the test isolation. Likely fixes:
// move this mock into a shared Vitest setup file so it applies worker-wide
// regardless of load order, or give this spec its own worker (isolate/threads
// config). Until then, a failure here is very likely THIS bug rather than a
// regression: re-run the suite before investigating.
vi.mock('socket.io-client', () => ({
  io: () => fakeSocket,
}));

describe('QueueSocketService — staff-watch refcounting', () => {
  let service: QueueSocketService;

  beforeEach(async () => {
    fakeSocket.emit.mockClear();
    fakeSocket.on.mockClear();
    fakeEncryption.invalidate.mockClear();
    TestBed.configureTestingModule({
      providers: [
        QueueSocketService,
        { provide: PayloadEncryptionService, useValue: fakeEncryption },
      ],
    });
    service = TestBed.inject(QueueSocketService);
    service.connect();
    await vi.waitFor(() => expect(fakeSocket.on).toHaveBeenCalled());
  });

  it('renews the encryption session after a server disconnect', async () => {
    const disconnectHandler = fakeSocket.on.mock.calls.find(
      ([event]) => event === 'disconnect',
    )?.[1] as ((reason: string) => void) | undefined;

    expect(disconnectHandler).toBeDefined();
    disconnectHandler?.('io server disconnect');

    expect(fakeEncryption.invalidate).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(fakeSocket.on).toHaveBeenCalledTimes(10));
  });

  it('leaves transport-close reconnection to Socket.IO', () => {
    const disconnectHandler = fakeSocket.on.mock.calls.find(
      ([event]) => event === 'disconnect',
    )?.[1] as ((reason: string) => void) | undefined;

    disconnectHandler?.('transport close');

    expect(fakeEncryption.invalidate).not.toHaveBeenCalled();
  });

  it('joins the staff room on first watch', async () => {
    service.watchQueueAsStaff('q1');
    await vi.waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith('joinQueueStaff', { queueId: 'q1' }),
    );
  });

  it('does not leave the room while a second watcher still wants it', () => {
    service.watchQueueAsStaff('q1'); // e.g. QueueConsoleService
    service.watchQueueAsStaff('q1'); // e.g. QueueSoundWatcherService
    fakeSocket.emit.mockClear();

    service.unwatchQueue('q1'); // console page unmounts

    expect(fakeSocket.emit).not.toHaveBeenCalledWith('leaveQueue', expect.anything());
  });

  it('leaves the room once the last watcher drops', async () => {
    service.watchQueueAsStaff('q1');
    service.watchQueueAsStaff('q1');
    fakeSocket.emit.mockClear();

    service.unwatchQueue('q1'); // first watcher gone — still one left
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('leaveQueue', expect.anything());

    service.unwatchQueue('q1'); // last watcher gone
    await vi.waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith('leaveQueue', { queueId: 'q1' }),
    );
  });

  it('re-watching after a full unwatch rejoins the room', async () => {
    service.watchQueueAsStaff('q1');
    service.unwatchQueue('q1');
    fakeSocket.emit.mockClear();

    service.watchQueueAsStaff('q1');

    await vi.waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith('joinQueueStaff', { queueId: 'q1' }),
    );
  });

  it('tracks separate queues independently', async () => {
    service.watchQueueAsStaff('q1');
    service.watchQueueAsStaff('q2');
    fakeSocket.emit.mockClear();

    service.unwatchQueue('q1');

    await vi.waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith('leaveQueue', { queueId: 'q1' }),
    );
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('leaveQueue', { queueId: 'q2' });
  });

  it('customer watch and single staff watch both clear on one unwatchQueue call', async () => {
    // unwatchQueue has no notion of "which kind of watch is this caller
    // dropping" — it always clears the customer entry and decrements the
    // staff refcount together. With only one staff watcher, one call empties
    // both sets and leaveQueue fires.
    service.watchQueue('q1'); // customer watch
    service.watchQueueAsStaff('q1'); // staff watch, same queue
    fakeSocket.emit.mockClear();

    service.unwatchQueue('q1');

    await vi.waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith('leaveQueue', { queueId: 'q1' }),
    );
  });

  it('disconnect() clears refcounts so a later watch starts fresh', async () => {
    service.watchQueueAsStaff('q1');
    service.watchQueueAsStaff('q1');
    service.disconnect();

    service.connect();
    fakeSocket.emit.mockClear();
    service.watchQueueAsStaff('q1');
    service.unwatchQueue('q1');

    // Refcount should be 1 after disconnect wiped state, not 2 — so this
    // single unwatch already leaves the room.
    await vi.waitFor(() =>
      expect(fakeSocket.emit).toHaveBeenCalledWith('leaveQueue', { queueId: 'q1' }),
    );
  });
});
