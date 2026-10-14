import { EMPTY, Observable, concat, defer, filter, finalize, of, shareReplay, tap } from 'rxjs';

/** Replays cached data, shares background requests, and retains 40 recent results. */
export class SessionRequestCache<T> {
  private readonly _values = new Map<string, T>();
  private readonly _requests = new Map<string, Observable<T>>();
  private _session = 0;

  get(key: string, fetch: () => Observable<T>): Observable<T> {
    // Resolve both the cache and session at subscription time. An observable
    // created before logout must never replay the previous account's response.
    return defer(() => {
      const session = this._session;
      const fresh$ = defer(() => {
        if (session !== this._session) return EMPTY;
        const pending = this._requests.get(key);
        if (pending) return pending;
        const request$ = defer(fetch).pipe(
          filter(() => session === this._session),
          tap((value) => this.set(key, value)),
          finalize(() => {
            if (this._requests.get(key) === request$) this._requests.delete(key);
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
        this._requests.set(key, request$);
        return request$;
      });
      const cached = this._values.get(key);
      if (cached === undefined) return fresh$;
      this.set(key, cached);
      return concat(of(cached), fresh$);
    });
  }

  peek(key: string): T | undefined {
    return this._values.get(key);
  }

  entries(): IterableIterator<[string, T]> {
    return this._values.entries();
  }

  set(key: string, value: T): void {
    this._values.delete(key);
    this._values.set(key, value);
    if (this._values.size > 40) this._values.delete(this._values.keys().next().value!);
  }

  clear(): void {
    this._session++;
    this._requests.clear();
    this._values.clear();
  }
}
