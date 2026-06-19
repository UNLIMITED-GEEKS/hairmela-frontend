import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NoSalonsEmptyStateComponent } from '../shared/no-salons-empty-state/no-salons-empty-state.component';
import { PendingInvitesComponent } from '../salon/pending-invites/pending-invites.component';

@Component({
  selector: 'app-customer-dashboard',
  templateUrl: './customer-dashboard.component.html',
  imports: [NoSalonsEmptyStateComponent, PendingInvitesComponent],
})
export class CustomerDashboardComponent {
  private readonly _router = inject(Router);

  protected navigateToCreateSalon(): void {
    this._router.navigate(['/salons/new']);
  }
}
