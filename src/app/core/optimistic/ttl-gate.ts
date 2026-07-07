/**
 * Answers "is the last fetch still fresh?" for data that changes too often to
 * cache indefinitely (CachedLoader) but is cheap to leave briefly stale — e.g.
 * a customer's own active-queue list, refreshed by socket/manual pull anyway.
 *
 * Deliberately NOT part of CachedLoader: it doesn't touch the signal, the
 * OptimisticService ledger, or CacheRegistry — it only gates whether a caller
 * should skip firing a fetch. The service keeps owning its own signal + HTTP
 * call exactly as before; this just wraps the "should I skip this load()?" check.
 *
 * Usage in a service:
 * ```ts
 * private readonly _ttl = new TtlGate(15_000);
 *
 * load(): void {
 *   if (this._ttl.isFresh()) return;
 *   ...fetch as before...
 *   next: (res) => { ...; this._ttl.markFetched(); },
 * }
 *
 * refresh(): void { this._ttl.invalidate(); this.load(); }
 * ```
 */
export class TtlGate {
  private _fetchedAt = 0;

  constructor(private readonly _ttlMs: number) {}

  isFresh(): boolean {
    return this._fetchedAt > 0 && Date.now() - this._fetchedAt < this._ttlMs;
  }

  markFetched(): void {
    this._fetchedAt = Date.now();
  }

  invalidate(): void {
    this._fetchedAt = 0;
  }
}
