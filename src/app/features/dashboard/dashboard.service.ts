import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { MySalonDto } from '../../api/models/my-salon-dto';
import { userSalonsControllerFindMine } from '../../api/fn/salons/user-salons-controller-find-mine';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

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
      },
      error: () => this._loading.set(false),
    });
  }
}
