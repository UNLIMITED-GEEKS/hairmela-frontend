import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { Closure } from '../../api/models/closure';
import { CreateClosureDto } from '../../api/models/create-closure-dto';
import { salonClosuresControllerFindAll } from '../../api/fn/schedules/salon-closures-controller-find-all';
import { salonClosuresControllerCreate } from '../../api/fn/schedules/salon-closures-controller-create';
import { salonClosuresControllerDelete } from '../../api/fn/schedules/salon-closures-controller-delete';
import { staffClosuresControllerFindAll } from '../../api/fn/schedules/staff-closures-controller-find-all';
import { staffClosuresControllerCreate } from '../../api/fn/schedules/staff-closures-controller-create';
import { staffClosuresControllerDelete } from '../../api/fn/schedules/staff-closures-controller-delete';

@Injectable({ providedIn: 'root' })
export class ClosuresService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  private readonly _salonCache = new Map<string, Closure[]>();
  private readonly _staffCache = new Map<string, Closure[]>();

  private readonly _salonClosures = signal<Closure[]>([]);
  private readonly _staffClosures = signal<Closure[]>([]);
  private readonly _loading = signal(false);
  private readonly _acting = signal(false);

  readonly salonClosures = this._salonClosures.asReadonly();
  readonly staffClosures = this._staffClosures.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly acting = this._acting.asReadonly();

  loadSalon(salonId: string): void {
    const cached = this._salonCache.get(salonId);
    if (cached) { this._salonClosures.set(cached); return; }
    this._fetchSalon(salonId);
  }

  loadStaff(salonId: string, staffId: string): void {
    const key = `${salonId}:${staffId}`;
    const cached = this._staffCache.get(key);
    if (cached) { this._staffClosures.set(cached); return; }
    this._fetchStaff(salonId, staffId);
  }

  refreshSalon(salonId: string): void {
    this._salonCache.delete(salonId);
    this._fetchSalon(salonId);
  }

  refreshStaff(salonId: string, staffId: string): void {
    this._staffCache.delete(`${salonId}:${staffId}`);
    this._fetchStaff(salonId, staffId);
  }

  createSalon(salonId: string, body: CreateClosureDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    salonClosuresControllerCreate(this._http, this._apiConfig.rootUrl, { salonId, body }).subscribe({
      next: () => { this._acting.set(false); this.refreshSalon(salonId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  createStaff(salonId: string, staffId: string, body: CreateClosureDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffClosuresControllerCreate(this._http, this._apiConfig.rootUrl, { salonId, staffId, body }).subscribe({
      next: () => { this._acting.set(false); this.refreshStaff(salonId, staffId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  deleteSalon(salonId: string, closureId: string, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    salonClosuresControllerDelete(this._http, this._apiConfig.rootUrl, { salonId, closureId }).subscribe({
      next: () => { this._acting.set(false); this.refreshSalon(salonId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  deleteStaff(salonId: string, staffId: string, closureId: string, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffClosuresControllerDelete(this._http, this._apiConfig.rootUrl, { salonId, staffId, closureId }).subscribe({
      next: () => { this._acting.set(false); this.refreshStaff(salonId, staffId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  clear(): void {
    this._salonCache.clear();
    this._staffCache.clear();
    this._salonClosures.set([]);
    this._staffClosures.set([]);
  }

  private _fetchSalon(salonId: string): void {
    this._loading.set(true);
    salonClosuresControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId }).subscribe({
      next: (res) => { this._salonCache.set(salonId, res.body); this._salonClosures.set(res.body); this._loading.set(false); },
      error: () => this._loading.set(false),
    });
  }

  private _fetchStaff(salonId: string, staffId: string): void {
    this._loading.set(true);
    staffClosuresControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId, staffId }).subscribe({
      next: (res) => {
        this._staffCache.set(`${salonId}:${staffId}`, res.body);
        this._staffClosures.set(res.body);
        this._loading.set(false);
      },
      error: () => this._loading.set(false),
    });
  }
}
