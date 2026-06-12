import { Component, inject, signal, output } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../../api/api-configuration';
import { Notification } from '../../../../api/models/notification';
import { notificationsControllerGetInbox } from '../../../../api/fn/notifications/notifications-controller-get-inbox';
import { staffInviteControllerAccept } from '../../../../api/fn/staff/staff-invite-controller-accept';
import { staffInviteControllerDecline } from '../../../../api/fn/staff/staff-invite-controller-decline';
import { MembershipStore } from '../../../../core/salon-context/membership.store';
import { ToastService } from '../../../../core/toast/toast.service';

@Component({
  selector: 'app-pending-invites',
  templateUrl: './pending-invites.component.html',
})
export class PendingInvitesComponent {
  readonly inviteActioned = output<void>();

  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _toast = inject(ToastService);

  protected readonly invites = signal<Notification[]>([]);
  protected readonly loading = signal(true);
  protected readonly actioning = signal<string | null>(null);

  constructor() {
    notificationsControllerGetInbox(this._http, this._apiConfig.rootUrl, { limit: '50' }).pipe(
      takeUntilDestroyed(),
    ).subscribe({
      next: (res) => {
        const pending = res.body.data.filter((n) => n.type === 'STAFF_INVITED' && !n.readAt);
        this.invites.set(pending);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected accept(invite: Notification): void {
    if (!invite.entityId || this.actioning()) return;
    this.actioning.set(invite.id);

    staffInviteControllerAccept(this._http, this._apiConfig.rootUrl, { salonId: invite.entityId }).subscribe({
      next: () => {
        this._membershipStore.invalidate(invite.entityId!);
        this.invites.update((list) => list.filter((i) => i.id !== invite.id));
        this.actioning.set(null);
        this._toast.success('Invite accepted');
        this.inviteActioned.emit();
      },
      error: () => {
        this.actioning.set(null);
        this._toast.error('Failed to accept invite');
      },
    });
  }

  protected decline(invite: Notification): void {
    if (!invite.entityId || this.actioning()) return;
    this.actioning.set(invite.id);

    staffInviteControllerDecline(this._http, this._apiConfig.rootUrl, { salonId: invite.entityId }).subscribe({
      next: () => {
        this.invites.update((list) => list.filter((i) => i.id !== invite.id));
        this.actioning.set(null);
        this._toast.success('Invite declined');
      },
      error: () => {
        this.actioning.set(null);
        this._toast.error('Failed to decline invite');
      },
    });
  }
}
