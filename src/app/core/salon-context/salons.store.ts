import { CacheRegistry } from '../caching/cache-registry/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  Subject,
  forkJoin,
  of,
  switchMap,
  tap,
  map,
  retry,
  catchError,
  filter,
  shareReplay,
  take,
} from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { MySalonDto } from '../../api/models/my-salon-dto';
import { userSalonsControllerFindMine } from '../../api/fn/salons/user-salons-controller-find-mine';
import { MembershipStore } from './membership.store';

interface SalonsLoadResult {
  readonly generation: number;
  readonly salons: MySalonDto[];
}

@Injectable({ providedIn: 'root' })
export class SalonsStore {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);

  private readonly _salons = signal<MySalonDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);

  readonly salons = this._salons.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  // Each emission (re)fetches the salons list. `showLoading` lets a caller
  // refetch in the background without blanking the dashboard (see refreshSilent).
  // switchMap cancels a superseded in-flight fetch, so overlapping triggers
  // never race — the latest one always wins.
  private readonly _reload$ = new Subject<{ showLoading: boolean; generation: number }>();
  private _triggered = false;
  private _generation = 0;

  // Single source of truth for the salons list. shareReplay(1) means every
  // consumer — the signals below, ensureLoaded(), any future caller — shares
  // one in-flight request and its cached result, with no manual loaded/
  // inflight bookkeeping. A failed fetch surfaces as a next([]) with the error
  // signal set (not a stream error), so a transient failure doesn't tear the
  // shared stream down and permanently break every later subscriber.
  private readonly _salons$: Observable<SalonsLoadResult> = this._reload$.pipe(
    switchMap(({ showLoading, generation }) => {
      if (showLoading) this._loading.set(true);
      this._error.set(false);
      return userSalonsControllerFindMine(this._http, this._apiConfig.rootUrl).pipe(
        retry(1),
        map((res) => res.body),
        // Warm the membership cache for each salon before completing, so
        // consumers that read role/tier next don't each trigger their own fetch.
        switchMap((salons) =>
          salons.length === 0
            ? of(salons)
            : forkJoin(salons.map((s) => this._membershipStore.getMembership(s.salon.id))).pipe(
                map(() => salons),
              ),
        ),
        map((salons) => ({ generation, salons })),
        tap(() => this._loading.set(false)),
        catchError(() => {
          this._loading.set(false);
          this._error.set(true);
          return of<SalonsLoadResult>({ generation, salons: [] });
        }),
      );
    }),
    shareReplay(1),
  );

  constructor() {
    this._cacheRegistry.register(this);
    // The one subscription that mirrors the shared stream into the signal.
    this._salons$.pipe(takeUntilDestroyed()).subscribe(({ generation, salons }) => {
      // clear() advances the generation. Ignore an old account's request if
      // it happens to finish while logout is tearing down the session.
      if (generation === this._generation) this._salons.set(salons);
    });
  }

  /** Fetch once; no-op if already triggered. Use refresh() to force a refetch. */
  load(): void {
    if (this._triggered) return;
    this._triggered = true;
    this._reload$.next({ showLoading: true, generation: ++this._generation });
  }

  refresh(): void {
    this._triggered = true;
    this._reload$.next({ showLoading: true, generation: ++this._generation });
  }

  // Re-fetch without touching `loading` — for callers whose mutation already
  // painted its own optimistic result (e.g. accepting an invite) and where the
  // dashboard is very likely still on screen. Flipping `loading` here would
  // blank the whole dashboard behind an already-successful action; the new
  // salon simply appears in `salons` once the background fetch resolves.
  refreshSilent(): void {
    this._triggered = true;
    this._reload$.next({ showLoading: false, generation: ++this._generation });
  }

  // Resolves with the salons once loaded, reusing the shared stream's cached
  // or in-flight result instead of issuing a new request. For callers (e.g.
  // route guards) that need the data before proceeding, not just triggering a
  // background load. Throws if the fetch failed so callers can distinguish a
  // real "no salons" result from an errored load (the stream itself maps
  // errors to [] to stay alive, so we re-raise here off the error signal).
  ensureLoaded(): Observable<MySalonDto[]> {
    this.load();
    const generation = this._generation;
    return this._salons$.pipe(
      // shareReplay still contains the previous account's final result after
      // clear(). Wait for this generation instead of taking that stale value.
      filter((result) => result.generation === generation),
      take(1),
      map(({ salons }) => {
        if (this._error()) throw new Error('Failed to load salons');
        return salons;
      }),
    );
  }

  clear(): void {
    // Invalidates both replayed and currently in-flight results from the old
    // identity. The next load receives a newer generation of its own.
    this._generation++;
    this._salons.set([]);
    this._triggered = false;
  }
}
