import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { MySalonDto } from '../../api/models/my-salon-dto';
import { userSalonsControllerFindMine } from '../../api/fn/salons/user-salons-controller-find-mine';
import { MembershipStore } from '../../core/salon-context/membership.store';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);

  constructor() { this._cacheRegistry.register(this); }

  private readonly _salons = signal<MySalonDto[]>([]);
  private readonly _loading = signal(false);
  private _loaded = false;

  readonly salons = this._salons.asReadonly();
  readonly loading = this._loading.asReadonly();

  load(): void {
    if (this._loaded) return;
    this._fetch();
  }

  refresh(): void {
    this._loaded = false;
    this._fetch();
  }

  clear(): void {
    this._salons.set([]);
    this._loaded = false;
  }

  private _fetch(): void {
    this._loading.set(true);
    userSalonsControllerFindMine(this._http, this._apiConfig.rootUrl).subscribe({
      next: (res) => {
        this._salons.set(res.body);
        this._loaded = true;
        this._loading.set(false);
        res.body.forEach((s) => this._membershipStore.getMembership(s.salon.id).subscribe());
      },
      error: () => this._loading.set(false),
    });
  }
}
