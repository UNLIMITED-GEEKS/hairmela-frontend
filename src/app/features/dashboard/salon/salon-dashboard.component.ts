import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardService } from '../dashboard.service';
import { MySalonsListComponent } from './my-salons-list/my-salons-list.component';
import { NoSalonsEmptyStateComponent } from '../shared/no-salons-empty-state/no-salons-empty-state.component';
import { PendingInvitesComponent } from './pending-invites/pending-invites.component';

@Component({
  selector: 'app-salon-dashboard',
  templateUrl: './salon-dashboard.component.html',
  imports: [MySalonsListComponent, NoSalonsEmptyStateComponent, PendingInvitesComponent],
})
export class SalonDashboardComponent {
  private readonly _router = inject(Router);
  private readonly _dashboardService = inject(DashboardService);

  protected readonly salons = this._dashboardService.salons;

  protected navigateToCreateSalon(): void {
    this._router.navigate(['/salons/new']);
  }
}
