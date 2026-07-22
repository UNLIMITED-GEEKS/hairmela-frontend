import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { QueueSocketService } from './queue-socket.service';

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

vi.mock('socket.io-client', () => ({
  io: () => fakeSocket,
}));

describe('QueueSocketService — staff-watch refcounting', () => {
  let service: QueueSocketService;

  beforeEach(() => {
    fakeSocket.emit.mockClear();
    TestBed.configureTestingModule({ providers: [QueueSocketService] });
    service = TestBed.inject(QueueSocketService);
    service.connect();
  });

  it('joins the staff room on first watch', () => {
    service.watchQueueAsStaff('q1');
    expect(fakeSocket.emit).toHaveBeenCalledWith('joinQueueStaff', { queueId: 'q1' });
  });

  it('does not leave the room while a second watcher still wants it', () => {
    service.watchQueueAsStaff('q1'); // e.g. QueueConsoleService
    service.watchQueueAsStaff('q1'); // e.g. QueueSoundWatcherService
    fakeSocket.emit.mockClear();

    service.unwatchQueue('q1'); // console page unmounts

    expect(fakeSocket.emit).not.toHaveBeenCalledWith('leaveQueue', expect.anything());
  });

  it('leaves the room once the last watcher drops', () => {
    service.watchQueueAsStaff('q1');
    service.watchQueueAsStaff('q1');
    fakeSocket.emit.mockClear();

    service.unwatchQueue('q1'); // first watcher gone — still one left
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('leaveQueue', expect.anything());

    service.unwatchQueue('q1'); // last watcher gone
    expect(fakeSocket.emit).toHaveBeenCalledWith('leaveQueue', { queueId: 'q1' });
  });

  it('re-watching after a full unwatch rejoins the room', () => {
    service.watchQueueAsStaff('q1');
    service.unwatchQueue('q1');
    fakeSocket.emit.mockClear();

    service.watchQueueAsStaff('q1');

    expect(fakeSocket.emit).toHaveBeenCalledWith('joinQueueStaff', { queueId: 'q1' });
  });

  it('tracks separate queues independently', () => {
    service.watchQueueAsStaff('q1');
    service.watchQueueAsStaff('q2');
    fakeSocket.emit.mockClear();

    service.unwatchQueue('q1');

    expect(fakeSocket.emit).toHaveBeenCalledWith('leaveQueue', { queueId: 'q1' });
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('leaveQueue', { queueId: 'q2' });
  });

  it('customer watch and single staff watch both clear on one unwatchQueue call', () => {
    // unwatchQueue has no notion of "which kind of watch is this caller
    // dropping" — it always clears the customer entry and decrements the
    // staff refcount together. With only one staff watcher, one call empties
    // both sets and leaveQueue fires.
    service.watchQueue('q1'); // customer watch
    service.watchQueueAsStaff('q1'); // staff watch, same queue
    fakeSocket.emit.mockClear();

    service.unwatchQueue('q1');

    expect(fakeSocket.emit).toHaveBeenCalledWith('leaveQueue', { queueId: 'q1' });
  });

  it('disconnect() clears refcounts so a later watch starts fresh', () => {
    service.watchQueueAsStaff('q1');
    service.watchQueueAsStaff('q1');
    service.disconnect();

    service.connect();
    fakeSocket.emit.mockClear();
    service.watchQueueAsStaff('q1');
    service.unwatchQueue('q1');

    // Refcount should be 1 after disconnect wiped state, not 2 — so this
    // single unwatch already leaves the room.
    expect(fakeSocket.emit).toHaveBeenCalledWith('leaveQueue', { queueId: 'q1' });
  });
});
