import { CacheRegistry } from '../../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Salon } from '../../../api/models/salon';
import { SalonStaff } from '../../../api/models/salon-staff';
import { salonsControllerFindOne } from '../../../api/fn/salons/salons-controller-find-one';
import { staffControllerFindAll } from '../../../api/fn/staff/staff-controller-find-all';
import { staffControllerToggleAcceptingClients } from '../../../api/fn/staff/staff-controller-toggle-accepting-clients';
import { MembershipStore } from '../../../core/salon-context/membership.store';
import { ToastService } from '../../../core/toast/toast.service';

interface MyStaff {
  id: string;
  queueId: string | null;
  isAcceptingClients: boolean;
  role: SalonStaff['role'];
}

interface SalonOverviewCache {
  salon: Salon;
  myStaff: MyStaff | null;
}

@Injectable({ providedIn: 'root' })
export class SalonOverviewService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _toast = inject(ToastService);

  constructor() { this._cacheRegistry.register(this); }

  private readonly _cache = new Map<string, SalonOverviewCache>();
  private readonly _salon = signal<Salon | null>(null);
  private readonly _myStaff = signal<MyStaff | null>(null);
  private readonly _loading = signal(false);
  private readonly _toggling = signal(false);

  readonly salon = this._salon.asReadonly();
  readonly myStaff = this._myStaff.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly toggling = this._toggling.asReadonly();

  load(salonId: string, currentUserId: string): void {
    const cached = this._cache.get(salonId);
    if (cached) {
      this._salon.set(cached.salon);
      this._myStaff.set(cached.myStaff);
      return;
    }
    this._fetch(salonId, currentUserId);
  }

  refresh(salonId: string, currentUserId: string): void {
    this._cache.delete(salonId);
    this._fetch(salonId, currentUserId);
  }

  toggleAcceptingClients(salonId: string, staffId: string): void {
    if (this._toggling()) return;
    const next = !this._myStaff()?.isAcceptingClients;
    this._toggling.set(true);
    staffControllerToggleAcceptingClients(this._http, this._apiConfig.rootUrl, {
      salonId,
      staffId,
      body: { isAcceptingClients: next },
    }).subscribe({
      next: () => {
        this._myStaff.update((s) => s ? { ...s, isAcceptingClients: next } : s);
        const cached = this._cache.get(salonId);
        if (cached?.myStaff) {
          this._cache.set(salonId, { ...cached, myStaff: { ...cached.myStaff, isAcceptingClients: next } });
        }
        this._toggling.set(false);
      },
      error: () => {
        this._toggling.set(false);
        this._toast.error('Failed to update status.');
      },
    });
  }

  invalidate(salonId: string): void {
    this._cache.delete(salonId);
  }

  clear(): void {
    this._cache.clear();
    this._salon.set(null);
    this._myStaff.set(null);
  }

  private _fetch(salonId: string, currentUserId: string): void {
    this._loading.set(true);
    forkJoin({
      salon: salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId }),
      staff: staffControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId }),
    }).subscribe({
      next: ({ salon, staff }) => {
        const mine = staff.body.find((s) => s.staff.userId === currentUserId);
        const myStaff: MyStaff | null = mine
          ? { id: mine.staff.id, queueId: mine.queueId, isAcceptingClients: mine.staff.isAcceptingClients, role: mine.staff.role }
          : null;
        const entry: SalonOverviewCache = { salon: salon.body, myStaff };
        this._cache.set(salonId, entry);
        this._salon.set(salon.body);
        this._myStaff.set(myStaff);
        this._loading.set(false);
      },
      error: () => this._loading.set(false),
    });
  }
}
