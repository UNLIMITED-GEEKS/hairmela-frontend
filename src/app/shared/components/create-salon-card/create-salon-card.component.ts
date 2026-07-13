import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { OrgContextService } from '../../../core/salon-context/org-context.service';
import { UNLIMITED_SENTINEL } from '../../../core/tier/tier-limits';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { RoutePath } from '../../../core/routing/route-paths';

// "Create a salon" CTA — shows the create-salon link while under the org's
// salon limit, or an upgrade prompt once it's reached. Shared by Account and
// Dashboard so both stay in sync with the same tier-limit logic.
@Component({
  selector: 'app-create-salon-card',
  templateUrl: './create-salon-card.component.html',
  imports: [RouterLink],
})
export class CreateSalonCardComponent {
  private readonly _dashboardService = inject(SalonsStore);
  private readonly _orgContext = inject(OrgContextService);

  protected readonly newSalonLink = RoutePath.newSalon();

  protected readonly canAddSalon = computed(() => {
    const limit = this._orgContext.access()?.salonLimit ?? UNLIMITED_SENTINEL;
    const owned = this._dashboardService.salons().filter((s) => s.role === SalonRole.OWNER).length;
    return owned < limit;
  });

  protected viewPlans(): void {
    this._orgContext.goToBilling();
  }
}
