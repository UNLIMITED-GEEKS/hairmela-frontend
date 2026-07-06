import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { retry } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { StaffWithQueueDto } from '../../api/models/staff-with-queue-dto';
import { InviteStaffDto } from '../../api/models/invite-staff-dto';
import { UpdateStaffRoleDto } from '../../api/models/update-staff-role-dto';
import { TransferOwnershipDto } from '../../api/models/transfer-ownership-dto';
import { PendingInviteDto } from '../../api/models/pending-invite-dto';
import { staffControllerFindAll } from '../../api/fn/staff/staff-controller-find-all';
import { staffControllerInvite } from '../../api/fn/staff/staff-controller-invite';
import { staffControllerFindInvites } from '../../api/fn/staff/staff-controller-find-invites';
import { staffControllerCancelInvite } from '../../api/fn/staff/staff-controller-cancel-invite';
import { staffControllerUpdateRole } from '../../api/fn/staff/staff-controller-update-role';
import { staffControllerTransferOwnership } from '../../api/fn/staff/staff-controller-transfer-ownership';
import { staffControllerRemove } from '../../api/fn/staff/staff-controller-remove';
import { staffControllerLeaveSalon } from '../../api/fn/staff/staff-controller-leave-salon';
import { MembershipStore } from '../../core/salon-context/membership.store';
import { ToastService } from '../../core/toast/toast.service';
import { OptimisticService, ReadToken } from '../../core/optimistic/optimistic.service';

@Injectable({ providedIn: 'root' })
export class StaffService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _toast = inject(ToastService);
  private readonly _optimistic = inject(OptimisticService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _cache = new Map<string, StaffWithQueueDto[]>();
  private readonly _staffList = signal<StaffWithQueueDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _acting = signal(false);

  // Pending invites are not cached — they change on every invite/cancel and the
  // manager needs the live state when on the invite page.
  private readonly _invites = signal<PendingInviteDto[]>([]);
  private readonly _invitesLoading = signal(false);
  private readonly _error = signal(false);
  private _inflight = new Set<string>();
  readonly staffList = this._staffList.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly acting = this._acting.asReadonly();
  readonly error = this._error.asReadonly();
  readonly invites = this._invites.asReadonly();
  readonly invitesLoading = this._invitesLoading.asReadonly();

  load(salonId: string): void {
    const token = this._optimistic.beginRead(this._staffList, salonId);
    const cached = this._cache.get(salonId);
    if (cached) {
      this._optimistic.commitRead(this._staffList, cached, token, (v) =>
        this._cache.set(salonId, v),
      );
      return;
    }
    if (this._inflight.has(salonId)) return;
    this._fetch(salonId, token);
  }

  refresh(salonId: string): void {
    const token = this._optimistic.beginRead(this._staffList, salonId);
    this._cache.delete(salonId);
    this._fetch(salonId, token);
  }

  invite(salonId: string, body: InviteStaffDto, onSuccess?: () => void): void {
    const tempId = `temp_${crypto.randomUUID()}`;
    // Predict: append a temp invite row instantly; reconcile via loadInvites
    // on success since the endpoint returns void (no body to reconcile from).
    const optimisticInvite: PendingInviteDto = {
      staffId: tempId,
      email: body.email,
      role: body.role,
      hasAccount: false,
      invitedAt: new Date().toISOString(),
    };
    this._optimistic.run({
      signal: this._invites,
      apply: (list) => [...list, optimisticInvite],
      contextKey: salonId,
      tempId,
      request: () => staffControllerInvite(this._http, this._apiConfig.rootUrl, { salonId, body }),
      errorMessage: 'Could not send invite. Reverted.',
      onSuccess: () => {
        this._toast.success('Invite sent');
        // Response is void — reload to get real invite data with server IDs
        this.loadInvites(salonId);
        this.refresh(salonId);
        onSuccess?.();
      },
    });
  }

  loadInvites(salonId: string): void {
    // Route reads through the engine so optimistic predictions survive in-flight loads
    const token = this._optimistic.beginRead(this._invites, salonId);
    this._invitesLoading.set(true);
    staffControllerFindInvites(this._http, this._apiConfig.rootUrl, { salonId }).subscribe({
      next: (res) => {
        this._optimistic.commitRead(this._invites, res.body, token);
        this._invitesLoading.set(false);
      },
      error: () => this._invitesLoading.set(false),
    });
  }

  cancelInvite(salonId: string, staffId: string): void {
    if (this._optimistic.isPending(staffId)) return;
    this._optimistic.run({
      signal: this._invites,
      apply: (list) => list.filter((i) => i.staffId !== staffId),
      contextKey: salonId,
      request: () =>
        staffControllerCancelInvite(this._http, this._apiConfig.rootUrl, { salonId, staffId }),
      errorMessage: 'Could not cancel invite. Restored.',
      onSuccess: () => this._toast.info('Invite cancelled'),
    });
  }

  leaveSalon(salonId: string, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffControllerLeaveSalon(this._http, this._apiConfig.rootUrl, { salonId }).subscribe({
      next: () => {
        this._acting.set(false);
        this._membershipStore.invalidate(salonId);
        this._toast.success('You have left the salon');
        onSuccess?.();
      },
      error: () => this._acting.set(false),
    });
  }

  updateRole(
    salonId: string,
    staffId: string,
    body: UpdateStaffRoleDto,
    onSuccess?: () => void,
  ): void {
    if (this._optimistic.isPending(staffId)) return;
    this._optimistic.run({
      signal: this._staffList,
      apply: (list) =>
        list.map((entry) =>
          entry.staff.id === staffId
            ? { ...entry, staff: { ...entry.staff, role: body.role } }
            : entry,
        ),
      mirror: (v) => this._cache.set(salonId, v),
      contextKey: salonId,
      request: () =>
        staffControllerUpdateRole(this._http, this._apiConfig.rootUrl, { salonId, staffId, body }),
      errorMessage: 'Could not update role. Reverted.',
      onSuccess: () => {
        this._toast.success('Role updated');
        onSuccess?.();
      },
    });
  }

  transferOwnership(salonId: string, body: TransferOwnershipDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    staffControllerTransferOwnership(this._http, this._apiConfig.rootUrl, {
      salonId,
      body,
    }).subscribe({
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
    if (this._optimistic.isPending(staffId)) return;
    this._optimistic.run({
      signal: this._staffList,
      apply: (list) => list.filter((entry) => entry.staff.id !== staffId),
      mirror: (v) => this._cache.set(salonId, v),
      contextKey: salonId,
      request: () =>
        staffControllerRemove(this._http, this._apiConfig.rootUrl, { salonId, staffId }),
      errorMessage: 'Could not remove staff member. Restored.',
      onSuccess: () => {
        this._toast.success('Staff member removed');
        onSuccess?.();
      },
    });
  }

  clear(): void {
    this._cache.clear();
    this._staffList.set([]);
    this._invites.set([]);
  }

  private _fetch(salonId: string, token: ReadToken): void {
    this._inflight.add(salonId);
    this._loading.set(true);
    this._error.set(false);
    staffControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight.delete(salonId);
          this._cache.set(salonId, res.body);
          this._optimistic.commitRead(this._staffList, res.body, token, (v) =>
            this._cache.set(salonId, v),
          );
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
