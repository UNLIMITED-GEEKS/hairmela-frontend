import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PLAN_CARDS } from '../../../core/tier/tier-plans';

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

  protected readonly orgId = this._route.snapshot.paramMap.get('orgId') ?? '';
  protected readonly plans = PLAN_CARDS.filter((p) => p.tier >= 2);
}
