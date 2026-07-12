import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { inject } from '@angular/core';
import { PendingInvitesComponent } from '../dashboard/salon/pending-invites/pending-invites.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { RoutePath } from '../../core/routing/route-paths';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.component.html',
  imports: [PendingInvitesComponent, PageHeaderComponent],
})
export class NotificationsComponent {
  private readonly _router = inject(Router);

  protected onInviteActioned(): void {
    this._router.navigate(RoutePath.dashboard());
  }
}
