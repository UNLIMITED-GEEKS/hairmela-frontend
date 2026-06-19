import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { StaffWithQueueDto } from '../../api/models/staff-with-queue-dto';
import { InviteStaffDto } from '../../api/models/invite-staff-dto';
import { UpdateStaffRoleDto } from '../../api/models/update-staff-role-dto';
import { TransferOwnershipDto } from '../../api/models/transfer-ownership-dto';
import { staffControllerFindAll } from '../../api/fn/staff/staff-controller-find-all';
import { staffControllerInvite } from '../../api/fn/staff/staff-controller-invite';
import { staffControllerUpdateRole } from '../../api/fn/staff/staff-controller-update-role';
import { staffControllerTransferOwnership } from '../../api/fn/staff/staff-controller-transfer-ownership';
import { staffControllerRemove } from '../../api/fn/staff/staff-controller-remove';
import { MembershipStore } from '../../core/salon-context/membership.store';
import { ToastService } from '../../core/toast/toast.service';

@Injectable({ providedIn: 'root' })
export class StaffService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _toast = inject(ToastService);

  constructor() { this._cacheRegistry.register(this); }

  private readonly _cache = new Map<string, StaffWithQueueDto[]>();
  private readonly _staffList = signal<StaffWithQueueDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _acting = signal(false);

  readonly staffList = this._staffList.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly acting = this._acting.asReadonly();

  load(salonId: string): void {
    const cached = this._cache.get(salonId);
    if (cached) {
      this._staffList.set(cached);
      return;
    }
    this._fetch(salonId);
  }

  refresh(salonId: string): void {
    this._cache.delete(salonId);
    this._fetch(salonId);
  }

  invite(salonId: string, body: InviteStaffDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffControllerInvite(this._http, this._apiConfig.rootUrl, { salonId, body }).subscribe({
      next: () => {
        this._acting.set(false);
        this._toast.success('Invite sent');
        this.refresh(salonId);
        onSuccess?.();
      },
      error: () => this._acting.set(false),
    });
  }

  updateRole(salonId: string, staffId: string, body: UpdateStaffRoleDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffControllerUpdateRole(this._http, this._apiConfig.rootUrl, { salonId, staffId, body }).subscribe({
      next: () => {
        this._acting.set(false);
        this._toast.success('Role updated');
        this.refresh(salonId);
        onSuccess?.();
      },
      error: () => this._acting.set(false),
    });
  }

  transferOwnership(salonId: string, body: TransferOwnershipDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffControllerTransferOwnership(this._http, this._apiConfig.rootUrl, { salonId, body }).subscribe({
      next: () => {
        this._acting.set(false);
        this._toast.success('Ownership transferred');
        this._membershipStore.invalidate(salonId);
        this.refresh(salonId);
        onSuccess?.();
      },
      error: () => this._acting.set(false),
    });
  }

  remove(salonId: string, staffId: string, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffControllerRemove(this._http, this._apiConfig.rootUrl, { salonId, staffId }).subscribe({
      next: () => {
        this._acting.set(false);
        this._toast.success('Staff member removed');
        this.refresh(salonId);
        onSuccess?.();
      },
      error: () => this._acting.set(false),
    });
  }

  clear(): void {
    this._cache.clear();
    this._staffList.set([]);
  }

  private _fetch(salonId: string): void {
    this._loading.set(true);
    staffControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId }).subscribe({
      next: (res) => {
        this._cache.set(salonId, res.body);
        this._staffList.set(res.body);
        this._loading.set(false);
      },
      error: () => this._loading.set(false),
    });
  }
}
