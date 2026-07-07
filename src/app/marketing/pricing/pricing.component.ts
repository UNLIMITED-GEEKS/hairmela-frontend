import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { PLAN_CARDS, formatPlanPrice } from '../../core/tier/tier-plans';

// Public marketing pricing page. Read-only — no live subscription calls; the
// transactional flow lives on the owner-only billing page. Signed-in users get
// a "Go to dashboard" CTA; everyone else gets "Get started" → register.
@Component({
  selector: 'app-pricing',
  templateUrl: './pricing.component.html',
  imports: [RouterLink],
})
export class PricingComponent {
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly isLoggedIn = !!this._currentUser.user();

  // Tier 1 (Free) is hidden until launch (FRONTEND-TIER-HANDOFF §9) — show the
  // paid plans only. Re-include tier 1 here when the floor flips to Free.
  protected readonly plans = PLAN_CARDS.filter((p) => p.tier >= 2);

  protected readonly formatPlanPrice = formatPlanPrice;
}
