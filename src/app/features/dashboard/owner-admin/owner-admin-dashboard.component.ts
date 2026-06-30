import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MySalonDto } from '../../../api/models/my-salon-dto';
import { OrgContextService } from '../../../core/salon-context/org-context.service';

@Component({
  selector: 'app-owner-admin-dashboard',
  templateUrl: './owner-admin-dashboard.component.html',
  imports: [RouterLink],
})
export class OwnerAdminDashboardComponent {
  private readonly _orgContext = inject(OrgContextService);

  readonly salon = input.required<MySalonDto>();
  readonly firstName = input<string>('');
  // Add-salon gate: false → the org is at its salon cap (show upgrade nudge).
  readonly canAddSalon = input<boolean>(true);

  // Resolve the org on demand at click time (see OrgContextService.goToBilling).
  protected viewPlans(): void {
    this._orgContext.goToBilling();
  }
}
