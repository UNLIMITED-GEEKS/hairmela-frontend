import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { map, retry } from 'rxjs';
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
import { CachedLoader } from '../../core/optimistic/cached-loader';

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
  private readonly _acting = signal(false);

  private readonly _loader = new CachedLoader({
    signal: this._staffList,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (salonId) =>
      staffControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId }).pipe(
        map((r) => r.body),
      ),
  });

  // Pending invites are not cached — they change on every invite/cancel and the
  // manager needs the live state when on the invite page.
  private readonly _invites = signal<PendingInviteDto[]>([]);
  private readonly _invitesLoading = signal(false);
  private readonly _invitesError = signal(false);
  private _invitesInflight = new Set<string>();
  readonly staffList = this._staffList.asReadonly();
  readonly loading = this._loader.loading;
  readonly acting = this._acting.asReadonly();
  readonly error = this._loader.error;
  readonly invites = this._invites.asReadonly();
  readonly invitesLoading = this._invitesLoading.asReadonly();
  readonly invitesError = this._invitesError.asReadonly();

  load(salonId: string): void {
    this._loader.load(salonId);
  }

  refresh(salonId: string): void {
    this._loader.refresh(salonId);
  }

  invite(salonId: string, body: InviteStaffDto, onSuccess?: () => void): void {
    const tempId = `temp_${crypto.randomUUID()}`;
    const optimisticInvite: PendingInviteDto = {
      staffId: tempId,
      email: body.email,
      role: body.role,
      hasAccount: false,
      invitedAt: new Date().toISOString(),
    };
    const accepted = this._optimistic.run({
      signal: this._invites,
      // apply is REPLAYED on every recompute (e.g. a concurrent loadInvites()
      // commitRead landing while this invite is still pending) — must be
      // idempotent or a replay duplicates the row. Guard by tempId.
      apply: (list) =>
        list.some((i) => i.staffId === tempId) ? list : [...list, optimisticInvite],
      // The backend returns the created SalonStaff — map its fields onto the
      // PendingInviteDto shape so the temp row gets the real staffId/invitedAt
      // without a refetch (SalonStaff.userId set means the invitee already has
      // an account, i.e. hasAccount).
      reconcile: (list, res) =>
        list.map((i) =>
          i.staffId === tempId
            ? {
                staffId: res.body.id,
                email: res.body.email,
                role: res.body.role,
                invitedAt: res.body.invitedAt,
                hasAccount: res.body.userId !== null,
              }
            : i,
        ),
      contextKey: salonId,
      tempId,
      dedupeKey: `StaffService.invite:${salonId}:${body.email}`,
      request: () => staffControllerInvite(this._http, this._apiConfig.rootUrl, { salonId, body }),
      errorMessage: 'Could not send invite. Reverted.',
      onSuccess: () => {
        // Invalidate (don't eagerly refetch) the staff list: the invite adds a
        // PENDING row there too, but a real StaffWithQueueDto needs the queueId
        // pairing this response doesn't carry, and an eager refresh() would
        // flip `loading` true and flash a skeleton on the staff list page for a
        // mutation that already succeeded — even if nobody's currently looking
        // at that page (invite-staff navigates away immediately). The next
        // visit to the staff list does a real fetch (cache miss) instead.
        this._cache.delete(salonId);
        onSuccess?.();
      },
    });
    // Optimistic: the temp invite row already painted, so tell the user now
    // rather than waiting on the network round-trip. If the invite actually
    // fails, the revert path above shows its own error toast. Only toast if
    // run() actually accepted the op — a dedupeKey-dropped re-entrant call
    // did nothing and shouldn't claim otherwise.
    if (accepted) this._toast.success('Invite sent');
  }

  loadInvites(salonId: string): void {
    // Route reads through the engine so optimistic predictions survive in-flight loads
    if (this._invitesInflight.has(salonId)) return;
    const token = this._optimistic.beginRead(this._invites, salonId);
    this._invitesInflight.add(salonId);
    this._invitesLoading.set(true);
    this._invitesError.set(false);
    staffControllerFindInvites(this._http, this._apiConfig.rootUrl, { salonId })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._invitesInflight.delete(salonId);
          this._optimistic.commitRead(this._invites, res.body, token);
          this._invitesLoading.set(false);
        },
        error: () => {
          this._invitesInflight.delete(salonId);
          this._invitesError.set(true);
          this._invitesLoading.set(false);
        },
      });
  }

  cancelInvite(salonId: string, staffId: string): void {
    const accepted = this._optimistic.run({
      signal: this._invites,
      apply: (list) => list.filter((i) => i.staffId !== staffId),
      contextKey: salonId,
      targetId: staffId,
      dedupeKey: `StaffService.cancelInvite:${salonId}:${staffId}`,
      request: () =>
        staffControllerCancelInvite(this._http, this._apiConfig.rootUrl, { salonId, staffId }),
      errorMessage: 'Could not cancel invite. Restored.',
    });
    // Optimistic: the row already disappeared, so tell the user now rather
    // than waiting on the network round-trip.
    if (accepted) this._toast.info('Invite cancelled');
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
    const accepted = this._optimistic.run({
      signal: this._staffList,
      apply: (list) =>
        list.map((entry) =>
          entry.staff.id === staffId
            ? { ...entry, staff: { ...entry.staff, role: body.role } }
            : entry,
        ),
      // The backend returns the full updated SalonStaff — fold it in so any
      // other server-side change lands too, not just the role we predicted.
      reconcile: (list, res) =>
        list.map((entry) => (entry.staff.id === staffId ? { ...entry, staff: res.body } : entry)),
      mirror: this._loader.mirrorFn(salonId),
      contextKey: salonId,
      targetId: staffId,
      dedupeKey: `StaffService.updateRole:${salonId}:${staffId}`,
      request: () =>
        staffControllerUpdateRole(this._http, this._apiConfig.rootUrl, { salonId, staffId, body }),
      errorMessage: 'Could not update role. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
    // Optimistic: the row already changed, so tell the user now rather than
    // waiting on the network round-trip.
    if (accepted) this._toast.success('Role updated');
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
    const accepted = this._optimistic.run({
      signal: this._staffList,
      apply: (list) => list.filter((entry) => entry.staff.id !== staffId),
      mirror: this._loader.mirrorFn(salonId),
      contextKey: salonId,
      targetId: staffId,
      dedupeKey: `StaffService.remove:${salonId}:${staffId}`,
      request: () =>
        staffControllerRemove(this._http, this._apiConfig.rootUrl, { salonId, staffId }),
      errorMessage: 'Could not remove staff member. Restored.',
      onSuccess: () => onSuccess?.(),
    });
    // Optimistic: the row already disappeared, so tell the user now rather
    // than waiting on the network round-trip.
    if (accepted) this._toast.success('Staff member removed');
  }

  clear(): void {
    this._cache.clear();
    this._optimistic.reset(this._staffList, []);
    this._optimistic.reset(this._invites, []);
  }
}
