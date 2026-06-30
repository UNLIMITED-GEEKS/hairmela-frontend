import { Component, computed, inject, signal } from '@angular/core';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { OrgContextService } from '../../../core/salon-context/org-context.service';

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
  private readonly _orgContext = inject(OrgContextService);

  private readonly _dismissed = signal(false);

  // Resolve the org on demand at click time, not via a precomputed routerLink —
  // ownedOrg() may not have resolved when the banner first paints, which would
  // otherwise leave the CTA pointing at the /dashboard fallback.
  protected upgrade(): void {
    this._orgContext.goToBilling();
  }

  protected readonly banner = computed<BannerView | null>(() => {
    const m = this._salonContext.membership();
    if (!m) return null;

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
        message: 'Your plan has ended — upgrade to restore full access.',
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
