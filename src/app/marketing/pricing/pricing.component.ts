import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { PLAN_CARDS, formatPlanPrice } from '../../core/tier/tier-plans';
import { RoutePath } from '../../core/routing/route-paths';
import { AppPlatformService } from '../../core/native/app-platform.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';

// Public marketing pricing page. Read-only — no live subscription calls; the
// transactional flow lives on the owner-only billing page. Signed-in users get
// a "Go to dashboard" CTA; everyone else gets "Get started" → register.
@Component({
  selector: 'app-pricing',
  templateUrl: './pricing.component.html',
  imports: [RouterLink, PageHeaderComponent],
})
export class PricingComponent {
  protected readonly platform = inject(AppPlatformService);

  protected readonly RoutePath = RoutePath;

  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly isLoggedIn = !!this._currentUser.user();

  // All three plans are paid — Standard, Pro, Scale. No free tier.
  protected readonly plans = PLAN_CARDS;
  protected readonly formatPlanPrice = formatPlanPrice;
  // The iOS app sells plans through Apple at App Store prices, which differ
  // from these website prices. Showing the website's lower prices inside the
  // app reads to App Review as steering users away from in-app purchase
  // (3.1.1 / 3.1.3), so the iOS app shows plans without them.
  protected readonly showPrices = this.platform.billingMode !== 'iap';
}
