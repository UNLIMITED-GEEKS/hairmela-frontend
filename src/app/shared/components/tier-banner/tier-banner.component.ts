import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { RoutePath } from '../../../core/routing/route-paths';

type BannerKind = 'trial' | 'expired' | 'free';

interface BannerView {
  readonly kind: BannerKind;
  readonly message: string;
  readonly cta: string;
}

// Global subscription banner. Decision tree (FRONTEND-TIER-HANDOFF §5):
//   isTrialing               → 🟦 "Free trial · N days left"
//   EXPIRED | CANCELLED      → 🟥 "Your plan has ended"
//   tier === 1               → 🟨 soft "You're on the Free plan"
//   ACTIVE tier 2/3          → no banner
// Branches on isTrialing/status, NEVER on the tier number (trial reads as 3).
// Drives off the active-salon membership, the same source as every gate.
@Component({
  selector: 'app-tier-banner',
  templateUrl: './tier-banner.component.html',
})
export class TierBannerComponent {
  private readonly _salonContext = inject(SalonContextService);
  private readonly _router = inject(Router);

  private readonly _dismissed = signal(false);

  // This salon's membership already carries orgId (GET /salons/:salonId/me) —
  // navigate straight there instead of OrgContextService.goToBilling()'s
  // GET /organizations/mine round-trip, which made this click wait on a live
  // network call purely to learn an orgId already sitting in membership().
  protected upgrade(): void {
    const orgId = this._salonContext.membership()?.orgId;
    if (!orgId) return;
    this._router.navigate(RoutePath.orgBilling(orgId));
  }

  // Billing is ORG-OWNER-only server-side (every subscription route is
  // class-level @OrgOwner(); OrgOwnerGuard 403s when org.ownerId !== user.id),
  // so only an owner gets the CTA — an admin's click used to bounce to
  // /dashboard via the frontend orgOwnerGuard. The banner itself still shows
  // for admins: trial days left is information they need, not an action.
  protected readonly canUpgrade = computed(
    () => this._salonContext.membership()?.role === SalonRole.OWNER,
  );

  protected readonly banner = computed<BannerView | null>(() => {
    const m = this._salonContext.membership();
    if (!m) return null;
    // Staff can neither act on nor are affected by plan state — don't nag them.
    if (!m.canManageSalon) return null;
    const owner = m.role === SalonRole.OWNER;

    if (m.isTrialing) {
      const days = m.daysLeft ?? 0;
      const dayLabel = days === 1 ? 'day' : 'days';
      return {
        kind: 'trial',
        message: `Free trial · ${days} ${dayLabel} left`,
        cta: 'Upgrade',
      };
    }

    if (m.status === 'EXPIRED' || m.status === 'CANCELLED') {
      return {
        kind: 'expired',
        message: owner
          ? 'Your plan has ended — upgrade to restore full access.'
          : 'This plan has ended — ask the owner to upgrade to restore full access.',
        cta: 'Upgrade',
      };
    }

    if (m.tier === 1) {
      return {
        kind: 'free',
        message: "You're on the Free plan.",
        cta: 'See plans',
      };
    }

    return null;
  });

  protected readonly visible = computed(() => !this._dismissed() && this.banner() !== null);

  // The free-plan nudge is soft and dismissible; trial/expired are not — they
  // carry an action the user needs and shouldn't be able to hide away.
  protected readonly dismissible = computed(() => this.banner()?.kind === 'free');

  protected dismiss(): void {
    this._dismissed.set(true);
  }
}
