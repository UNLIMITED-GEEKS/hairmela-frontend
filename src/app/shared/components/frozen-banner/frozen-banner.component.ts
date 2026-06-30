import { Component, computed, inject } from '@angular/core';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { OrgContextService } from '../../../core/salon-context/org-context.service';

// Shown on a frozen salon (handoff §5): the salon is over the plan's salon-count
// limit, so it's read-only. Owners/admins get an upgrade CTA; others get an
// informational notice. Reads SalonContextService — correct per active salon.
@Component({
  selector: 'app-frozen-banner',
  templateUrl: './frozen-banner.component.html',
})
export class FrozenBannerComponent {
  private readonly _salonContext = inject(SalonContextService);
  private readonly _orgContext = inject(OrgContextService);

  protected readonly frozen = this._salonContext.isFrozen;
  protected readonly canManage = computed(() => this._salonContext.membership()?.canManageSalon ?? false);

  // Resolve the org on demand at click time (see OrgContextService.goToBilling).
  protected upgrade(): void {
    this._orgContext.goToBilling();
  }
}
