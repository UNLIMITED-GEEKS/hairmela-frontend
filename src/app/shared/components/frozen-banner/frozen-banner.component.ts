import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { RoutePath } from '../../../core/routing/route-paths';

// Shown on a frozen salon (handoff §5): the salon is over the plan's salon-count
// limit, so it's read-only. Owners get an upgrade CTA; everyone else gets an
// informational notice. Reads SalonContextService — correct per active salon.
@Component({
  selector: 'app-frozen-banner',
  templateUrl: './frozen-banner.component.html',
})
export class FrozenBannerComponent {
  private readonly _salonContext = inject(SalonContextService);
  private readonly _router = inject(Router);

  protected readonly frozen = this._salonContext.isFrozen;
  // Billing is ORG-OWNER-only server-side: every subscription route is
  // class-level @OrgOwner() and OrgOwnerGuard 403s when org.ownerId !== user.id
  // (backend/src/common/guards/org-owner.guard.ts). canManageSalon includes
  // ADMIN, so gating the CTA on it sent admins to a page that either bounced
  // them (frontend orgOwnerGuard → /dashboard) or 403'd every request on it.
  // The notice still shows for admins — only the button is owner-only.
  protected readonly canManage = computed(
    () => this._salonContext.membership()?.role === SalonRole.OWNER,
  );

  // This salon's membership already carries orgId (GET /salons/:salonId/me) —
  // navigate straight there instead of OrgContextService.goToBilling()'s
  // GET /organizations/mine round-trip, which used to make this click wait on
  // a live network call (slow first-click-of-session on prod) purely to learn
  // an orgId this component already had in memory.
  protected upgrade(): void {
    const orgId = this._salonContext.membership()?.orgId;
    if (!orgId) return;
    this._router.navigate(RoutePath.orgBilling(orgId));
  }
}
