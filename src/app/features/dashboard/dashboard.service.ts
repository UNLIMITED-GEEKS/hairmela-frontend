import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { MySalonDto } from '../../api/models/my-salon-dto';
import { userSalonsControllerFindMine } from '../../api/fn/salons/user-salons-controller-find-mine';
import { MembershipStore } from '../../core/salon-context/membership.store';
import { forkJoin, retry } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _salons = signal<MySalonDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _loaded = false;
  private _inflight = false;

  readonly salons = this._salons.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(): void {
    if (this._loaded) return;
    if (this._inflight) return;
    this._fetch(true);
  }

  refresh(): void {
    this._loaded = false;
    this._fetch(true);
  }

  // Re-fetch without touching `loading` — for callers whose mutation already
  // painted its own optimistic result (e.g. accepting an invite) and where the
  // dashboard is very likely still on screen. Flipping `loading` here would
  // blank the whole dashboard behind an already-successful action; the new
  // salon simply appears in `salons` once the background fetch resolves.
  refreshSilent(): void {
    this._loaded = false;
    this._fetch(false);
  }

  clear(): void {
    this._salons.set([]);
    this._loaded = false;
  }

  private _fetch(showLoading: boolean): void {
    this._inflight = true;
    if (showLoading) this._loading.set(true);
    this._error.set(false);
    userSalonsControllerFindMine(this._http, this._apiConfig.rootUrl)
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._salons.set(res.body);
          if (res.body.length === 0) {
            this._inflight = false;
            this._loaded = true;
            if (showLoading) this._loading.set(false);
            return;
          }
          forkJoin(res.body.map((s) => this._membershipStore.getMembership(s.salon.id))).subscribe(
            () => {
              this._inflight = false;
              this._loaded = true;
              if (showLoading) this._loading.set(false);
            },
          );
        },
        error: () => {
          this._inflight = false;
          if (showLoading) this._error.set(true);
        },
      });
  }
}
