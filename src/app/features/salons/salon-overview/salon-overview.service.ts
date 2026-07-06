import { CacheRegistry } from '../../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { retry } from 'rxjs';
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
import { OptimisticService, ReadToken } from '../../../core/optimistic/optimistic.service';

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
  private readonly _optimistic = inject(OptimisticService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _cache = new Map<string, SalonOverviewCache>();
  private readonly _salon = signal<Salon | null>(null);
  private readonly _myStaff = signal<MyStaff | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _inflight = new Set<string>();

  readonly salon = this._salon.asReadonly();
  readonly myStaff = this._myStaff.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(salonId: string, currentUserId: string): void {
    const token = this._optimistic.beginRead(this._myStaff, salonId);
    const cached = this._cache.get(salonId);
    if (cached) {
      this._salon.set(cached.salon);
      this._optimistic.commitRead(this._myStaff, cached.myStaff, token, (v) => {
        const entry = this._cache.get(salonId);
        if (entry) this._cache.set(salonId, { ...entry, myStaff: v });
      });
      return;
    }
    if (this._inflight.has(salonId)) return;
    this._fetch(salonId, currentUserId, token);
  }

  refresh(salonId: string, currentUserId: string): void {
    const token = this._optimistic.beginRead(this._myStaff, salonId);
    this._cache.delete(salonId);
    this._fetch(salonId, currentUserId, token);
  }

  toggleAcceptingClients(salonId: string, staffId: string): void {
    const next = !this._myStaff()?.isAcceptingClients;
    this._optimistic.run({
      signal: this._myStaff,
      dedupeKey: `SalonOverviewService.toggleAcceptingClients:${staffId}`,
      apply: (s) => (s ? { ...s, isAcceptingClients: next } : s),
      mirror: (v) => {
        const entry = this._cache.get(salonId);
        if (entry) this._cache.set(salonId, { ...entry, myStaff: v });
      },
      contextKey: salonId,
      request: () =>
        staffControllerToggleAcceptingClients(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId,
          body: { isAcceptingClients: next },
        }),
      errorMessage: 'Failed to update status. Reverted.',
    });
  }

  invalidate(salonId: string): void {
    this._cache.delete(salonId);
  }

  clear(): void {
    this._cache.clear();
    this._salon.set(null);
    this._optimistic.reset(this._myStaff, null);
  }

  private _fetch(salonId: string, currentUserId: string, token: ReadToken): void {
    this._inflight.add(salonId);
    this._loading.set(true);
    this._error.set(false);
    forkJoin({
      salon: salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId }),
      staff: staffControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId }),
    })
      .pipe(retry(1))
      .subscribe({
        next: ({ salon, staff }) => {
          this._inflight.delete(salonId);
          const mine = staff.body.find((s) => s.staff.userId === currentUserId);
          const myStaff: MyStaff | null = mine
            ? {
                id: mine.staff.id,
                queueId: mine.queueId,
                isAcceptingClients: mine.staff.isAcceptingClients,
                role: mine.staff.role,
              }
            : null;
          const entry: SalonOverviewCache = { salon: salon.body, myStaff };
          this._cache.set(salonId, entry);
          this._salon.set(salon.body);
          // Commit through the engine so a concurrent toggle win doesn't get stomped
          this._optimistic.commitRead(this._myStaff, myStaff, token, (v) => {
            const cached = this._cache.get(salonId);
            if (cached) this._cache.set(salonId, { ...cached, myStaff: v });
          });
          this._loading.set(false);
        },
        error: () => {
          this._inflight.delete(salonId);
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }
}
