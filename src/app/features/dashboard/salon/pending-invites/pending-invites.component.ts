import { Component, inject, signal, output, DestroyRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiConfiguration } from '../../../../api/api-configuration';
import { Notification } from '../../../../api/models/notification';
import { notificationsControllerGetInbox } from '../../../../api/fn/notifications/notifications-controller-get-inbox';
import { salonMembershipControllerGetMyMembership } from '../../../../api/fn/staff/salon-membership-controller-get-my-membership';
import { staffInviteControllerAccept } from '../../../../api/fn/staff/staff-invite-controller-accept';
import { staffInviteControllerDecline } from '../../../../api/fn/staff/staff-invite-controller-decline';
import { MembershipStore } from '../../../../core/salon-context/membership.store';
import { ToastService } from '../../../../core/toast/toast.service';

interface InviteWithStatus {
  notification: Notification;
  isAlreadyStaff: boolean;
}

@Component({
  selector: 'app-pending-invites',
  templateUrl: './pending-invites.component.html',
})
export class PendingInvitesComponent {
  readonly inviteActioned = output<void>();

  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _toast = inject(ToastService);

  protected readonly invites = signal<InviteWithStatus[]>([]);
  protected readonly loading = signal(true);
  protected readonly actioning = signal<string | null>(null);

  constructor() {
    notificationsControllerGetInbox(this._http, this._apiConfig.rootUrl, { limit: '50' }).pipe(
      takeUntilDestroyed(this._destroyRef),
      map((res) => res.body.data.filter((n) => n.type === 'STAFF_INVITED')),
    ).subscribe({
      next: (notifications) => {
        if (notifications.length === 0) {
          this.loading.set(false);
          return;
        }

        const membershipChecks$ = notifications.map((n) =>
          n.entityId
            ? salonMembershipControllerGetMyMembership(this._http, this._apiConfig.rootUrl, { salonId: n.entityId }).pipe(
                map((res) => ({ notification: n, isAlreadyStaff: res.body.isStaff } satisfies InviteWithStatus)),
                catchError(() => of({ notification: n, isAlreadyStaff: false } satisfies InviteWithStatus)),
              )
            : of({ notification: n, isAlreadyStaff: false } satisfies InviteWithStatus),
        );

        forkJoin(membershipChecks$).pipe(
          takeUntilDestroyed(this._destroyRef),
        ).subscribe({
          next: (results) => {
            this.invites.set(results);
            this.loading.set(false);
          },
          error: () => this.loading.set(false),
        });
      },
      error: () => this.loading.set(false),
    });
  }

  protected accept(item: InviteWithStatus): void {
    const salonId = item.notification.entityId;
    if (!salonId || this.actioning()) return;
    this.actioning.set(item.notification.id);

    staffInviteControllerAccept(this._http, this._apiConfig.rootUrl, { salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this._membershipStore.invalidate(salonId);
        this.invites.update((list) =>
          list.map((i) => i.notification.id === item.notification.id
            ? { ...i, isAlreadyStaff: true }
            : i),
        );
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

  protected decline(item: InviteWithStatus): void {
    const salonId = item.notification.entityId;
    if (!salonId || this.actioning()) return;
    this.actioning.set(item.notification.id);

    staffInviteControllerDecline(this._http, this._apiConfig.rootUrl, { salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this.invites.update((list) => list.filter((i) => i.notification.id !== item.notification.id));
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
