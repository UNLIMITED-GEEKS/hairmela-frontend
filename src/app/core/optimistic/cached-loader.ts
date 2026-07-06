import { signal, WritableSignal } from '@angular/core';
import { defer, Observable, retry } from 'rxjs';
import { OptimisticService, ReadToken } from './optimistic.service';

export interface CachedLoaderConfig<T> {
  signal: WritableSignal<T>;
  optimistic: OptimisticService;
  /** Keyed by whatever contextKey the service uses (salonId, `${salonId}:${staffId}`, …). */
  cache: Map<string, T>;
  /**
   * Called with the contextKey; must return the fetched body as `Observable<T>`.
   * The loader pipes `retry(1)` internally — do not add it in the fetch fn.
   * Example: `(salonId) => myControllerList(http, rootUrl, { salonId }).pipe(map(r => r.body))`
   */
  fetch: (contextKey: string) => Observable<T>;
  /**
   * Whether the returned value should be written to the cache.
   * Default: always cache. Pass `(v) => v !== null` for nullable signals
   * (`signal<Foo | null>(null)`) so that reset() + reload doesn't cache null.
   */
  shouldCache?: (value: T) => boolean;
}

/**
 * Encapsulates the repeated load choreography that every engine-backed service
 * hand-copies: beginRead → cache-check → inflight-guard → fetch →
 * retry(1) → commitRead → loading/error state.
 *
 * Each engine-managed `(signal, cache)` pair gets ONE `CachedLoader` instance.
 * Services with two independent fetch families (e.g. ServicesService) create
 * two instances.
 *
 * Plain class — not injectable. Instantiated in the service's field initializer
 * after `inject()` calls (field order matters: declare loaders after injected deps).
 *
 * Usage in a service:
 * ```ts
 * private readonly _loader = new CachedLoader({
 *   signal: this._items,
 *   optimistic: this._optimistic,
 *   cache: this._cache,
 *   fetch: (salonId) =>
 *     myApiControllerList(this._http, this._apiConfig.rootUrl, { salonId })
 *       .pipe(map(r => r.body)),
 * });
 *
 * readonly loading = this._loader.loading;
 * readonly error = this._loader.error;
 *
 * load(salonId: string): void { this._loader.load(salonId); }
 * refresh(salonId: string): void { this._loader.refresh(salonId); }
 *
 * // In run() calls use mirrorFn() so mutation recomputes write to the cache
 * // the same way load() does:
 * this._optimistic.run({ ..., mirror: this._loader.mirrorFn(salonId) });
 * ```
 */
export class CachedLoader<T> {
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private readonly _inflight = new Set<string>();

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor(private readonly _config: CachedLoaderConfig<T>) {}

  /**
   * Load from cache if available, otherwise fetch.
   * Commits through beginRead/commitRead so optimistic ops survive concurrent loads.
   * Inflight guard prevents duplicate GETs for the same contextKey.
   */
  load(contextKey: string): void {
    const token = this._config.optimistic.beginRead(this._config.signal, contextKey);
    const cached = this._config.cache.get(contextKey);
    if (cached !== undefined) {
      this._config.optimistic.commitRead(
        this._config.signal,
        cached,
        token,
        this.mirrorFn(contextKey),
      );
      return;
    }
    if (this._inflight.has(contextKey)) return;
    this._doFetch(contextKey, token);
  }

  /**
   * Force a fresh fetch, bypassing cache and inflight guard.
   * Call after mutations to ensure the UI reflects server truth.
   * Epochs in OptimisticService ensure the freshest response wins when a
   * concurrent load() races this.
   */
  refresh(contextKey: string): void {
    const token = this._config.optimistic.beginRead(this._config.signal, contextKey);
    this._config.cache.delete(contextKey);
    this._doFetch(contextKey, token);
  }

  /**
   * Returns the cache write-through function for use as `mirror` in `run()` calls.
   * This ensures mutation recomputes write to the cache identically to how load()
   * does — no divergence between read and write cache paths.
   */
  mirrorFn(contextKey: string): (value: T) => void {
    return (value: T) => {
      if (this._shouldCache(value)) {
        this._config.cache.set(contextKey, value);
      }
    };
  }

  private _doFetch(contextKey: string, token: ReadToken): void {
    this._inflight.add(contextKey);
    this._loading.set(true);
    this._error.set(false);
    // defer() ensures each retry attempt calls fetch() fresh instead of
    // resubscribing to the same observable instance (which would always throw
    // for a stateful or factory-based fetch).
    defer(() => this._config.fetch(contextKey))
      .pipe(retry(1))
      .subscribe({
        next: (value) => {
          this._inflight.delete(contextKey);
          if (this._shouldCache(value)) {
            this._config.cache.set(contextKey, value);
          }
          this._config.optimistic.commitRead(
            this._config.signal,
            value,
            token,
            this.mirrorFn(contextKey),
          );
          this._loading.set(false);
        },
        error: () => {
          this._inflight.delete(contextKey);
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }

  private _shouldCache(value: T): boolean {
    return this._config.shouldCache ? this._config.shouldCache(value) : true;
  }
}
