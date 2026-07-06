import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { retry } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { MyInviteDto } from '../../api/models/my-invite-dto';
import { myInvitesControllerGetMyInvites } from '../../api/fn/staff/my-invites-controller-get-my-invites';
import { staffInviteControllerAccept } from '../../api/fn/staff/staff-invite-controller-accept';
import { staffInviteControllerDecline } from '../../api/fn/staff/staff-invite-controller-decline';
import { MembershipStore } from '../../core/salon-context/membership.store';
import { ToastService } from '../../core/toast/toast.service';
import { DashboardService } from './dashboard.service';
import { OptimisticService, ReadToken } from '../../core/optimistic/optimistic.service';

@Injectable({ providedIn: 'root' })
export class InvitesService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _toast = inject(ToastService);
  private readonly _dashboardService = inject(DashboardService);
  private readonly _optimistic = inject(OptimisticService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _invites = signal<MyInviteDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _loaded = false;
  private _inflight = false;

  readonly invites = this._invites.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(): void {
    const token = this._optimistic.beginRead(this._invites);
    if (this._loaded) {
      this._optimistic.commitRead(this._invites, this._invites(), token);
      return;
    }
    if (this._inflight) return;
    this._fetch(token);
  }

  refresh(): void {
    this._loaded = false;
    const token = this._optimistic.beginRead(this._invites);
    this._fetch(token);
  }

  clear(): void {
    this._invites.set([]);
    this._loaded = false;
  }

  accept(invite: MyInviteDto): void {
    if (this._optimistic.isPending(invite.staffId)) return;
    this._optimistic.run({
      signal: this._invites,
      apply: (list) => list.filter((i) => i.staffId !== invite.staffId),
      request: () =>
        staffInviteControllerAccept(this._http, this._apiConfig.rootUrl, {
          salonId: invite.salonId,
        }),
      errorMessage: 'Failed to accept invite.',
      onSuccess: () => {
        this._membershipStore.invalidate(invite.salonId);
        // Silent: the dashboard is very likely on screen right now (this is
        // its own pending-invites widget) — refresh() would flip `loading`
        // and blank the whole dashboard behind an action that already
        // succeeded. The new salon appears once this resolves in the background.
        this._dashboardService.refreshSilent();
        this._toast.success(`Joined ${invite.salonName}`);
      },
    });
  }

  decline(invite: MyInviteDto): void {
    if (this._optimistic.isPending(invite.staffId)) return;
    this._optimistic.run({
      signal: this._invites,
      apply: (list) => list.filter((i) => i.staffId !== invite.staffId),
      request: () =>
        staffInviteControllerDecline(this._http, this._apiConfig.rootUrl, {
          salonId: invite.salonId,
        }),
      errorMessage: 'Failed to decline invite.',
      onSuccess: () => this._toast.info(`Declined invite from ${invite.salonName}`),
    });
  }

  private _fetch(token: ReadToken): void {
    this._inflight = true;
    this._loading.set(true);
    this._error.set(false);
    myInvitesControllerGetMyInvites(this._http, this._apiConfig.rootUrl)
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight = false;
          this._optimistic.commitRead(this._invites, res.body, token);
          this._loaded = true;
          this._loading.set(false);
        },
        error: () => {
          this._inflight = false;
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }
}
