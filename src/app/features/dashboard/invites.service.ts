import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { MyInviteDto } from '../../api/models/my-invite-dto';
import { myInvitesControllerGetMyInvites } from '../../api/fn/staff/my-invites-controller-get-my-invites';
import { staffInviteControllerAccept } from '../../api/fn/staff/staff-invite-controller-accept';
import { staffInviteControllerDecline } from '../../api/fn/staff/staff-invite-controller-decline';
import { MembershipStore } from '../../core/salon-context/membership.store';
import { ToastService } from '../../core/toast/toast.service';

@Injectable({ providedIn: 'root' })
export class InvitesService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _toast = inject(ToastService);

  private readonly _invites = signal<MyInviteDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _responding = signal<string | null>(null);
  private _loaded = false;

  readonly invites = this._invites.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly responding = this._responding.asReadonly();

  load(): void {
    if (this._loaded) return;
    this._fetch();
  }

  refresh(): void {
    this._loaded = false;
    this._fetch();
  }

  clear(): void {
    this._invites.set([]);
    this._loaded = false;
  }

  accept(invite: MyInviteDto): void {
    if (this._responding()) return;
    this._responding.set(invite.staffId);
    staffInviteControllerAccept(this._http, this._apiConfig.rootUrl, { salonId: invite.salonId })
      .subscribe({
        next: () => {
          this._invites.update((list) => list.filter((i) => i.staffId !== invite.staffId));
          this._responding.set(null);
          this._membershipStore.invalidate(invite.salonId);
          this._toast.success(`Joined ${invite.salonName}`);
        },
        error: () => {
          this._responding.set(null);
          this._toast.error('Failed to accept invite.');
        },
      });
  }

  decline(invite: MyInviteDto): void {
    if (this._responding()) return;
    this._responding.set(invite.staffId);
    staffInviteControllerDecline(this._http, this._apiConfig.rootUrl, { salonId: invite.salonId })
      .subscribe({
        next: () => {
          this._invites.update((list) => list.filter((i) => i.staffId !== invite.staffId));
          this._responding.set(null);
          this._toast.info(`Declined invite from ${invite.salonName}`);
        },
        error: () => {
          this._responding.set(null);
          this._toast.error('Failed to decline invite.');
        },
      });
  }

  private _fetch(): void {
    this._loading.set(true);
    myInvitesControllerGetMyInvites(this._http, this._apiConfig.rootUrl).subscribe({
      next: (res) => {
        this._invites.set(res.body);
        this._loaded = true;
        this._loading.set(false);
      },
      error: () => this._loading.set(false),
    });
  }
}
