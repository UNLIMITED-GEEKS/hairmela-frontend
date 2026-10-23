import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PLAN_CARDS, formatPlanPrice } from '../../../core/tier/tier-plans';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { AppPlatformService } from '../../../core/native/app-platform.service';

// Static plan-comparison teaser. The transactional flow (upgrade/downgrade/
// cancel) lives on the billing page; this just links into it. Renders from
// PLAN_CARDS so the copy never drifts from the billing/pricing surfaces.
@Component({
  selector: 'app-plan-explainer',
  templateUrl: './plan-explainer.component.html',
  imports: [RouterLink],
})
export class PlanExplainerComponent {
  private readonly _route = inject(ActivatedRoute);

  protected readonly orgId = this._route.snapshot.paramMap.get(RouteParam.ORG_ID) ?? '';
  protected readonly plans = PLAN_CARDS;
  protected readonly formatPlanPrice = formatPlanPrice;
  // iOS sells plans through Apple: the website prices and "contact us" would
  // steer users away from in-app purchase (App Review 3.1.1 / 3.1.3). The
  // Billing link below shows App Store prices instead.
  protected readonly isIap = inject(AppPlatformService).billingMode === 'iap';

  protected get billingLink(): string[] {
    return RoutePath.orgBilling(this.orgId);
  }
}
