import { Subscription } from 'rxjs';
import { TtlGate } from './ttl-gate';
import { QueueSocketService } from '../../socket/queue-socket.service';

/**
 * A TtlGate whose staleness signal is primarily socket-driven: watches
 * customerCalled$ for a caller-supplied set of queue ids and invalidates the
 * TTL the instant any of them fires, instead of relying solely on the TTL's
 * fixed window. The TTL still exists as a fallback for when the socket never
 * told us anything changed (disconnected, missed an event, or zero ids to
 * watch) — see TtlGate's own doc comment for why it isn't removed outright.
 *
 * Also owns socket room hygiene: a queue id that drops out between calls to
 * sync() (its entry was served/cancelled/left) is unwatchQueue'd instead of
 * leaving a stale room joined for the rest of the session.
 *
 * Plain class — not injectable. Instantiated in the service's field
 * initializer after inject() calls, same convention as CachedLoader.
 *
 * Usage in a service:
 * ```ts
 * private readonly _watch = new SocketInvalidatedTtl(this._socket, 15_000);
 *
 * load(): void {
 *   if (this._inflight || this._watch.isFresh()) return;
 *   ...fetch as before...
 *   next: (res) => {
 *     ...
 *     this._watch.markFetched();
 *     this._watch.sync(res.body.map((e) => e.queueId));
 *   },
 * }
 *
 * refresh(): void { this._watch.invalidate(); this.load(); }
 * ```
 */
export class SocketInvalidatedTtl {
  private readonly _ttl: TtlGate;
  private _calledSubs: Subscription[] = [];
  private _watchedQueueIds = new Set<string>();

  constructor(
    private readonly _socket: QueueSocketService,
    ttlMs: number,
  ) {
    this._ttl = new TtlGate(ttlMs);
  }

  isFresh(): boolean {
    return this._ttl.isFresh();
  }

  markFetched(): void {
    this._ttl.markFetched();
  }

  invalidate(): void {
    this._ttl.invalidate();
  }

  /**
   * Reconciles socket watches against the queue ids currently relevant to the
   * caller. Unwatches ids that dropped out, watches new ones, and (re)subscribes
   * customerCalled$ for every currently-relevant id so a call event invalidates
   * the TTL immediately rather than waiting out the fallback window.
   */
  sync(queueIds: Iterable<string>): void {
    this._calledSubs.forEach((s) => s.unsubscribe());
    this._calledSubs = [];

    const nextIds = new Set(queueIds);

    for (const oldId of this._watchedQueueIds) {
      if (!nextIds.has(oldId)) this._socket.unwatchQueue(oldId);
    }
    this._watchedQueueIds = nextIds;

    if (nextIds.size === 0) return;

    this._socket.connect();
    for (const queueId of nextIds) {
      this._socket.watchQueue(queueId);
      this._calledSubs.push(
        this._socket.customerCalled$(queueId).subscribe(() => this.invalidate()),
      );
    }
  }
}
