import { Component, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { BillingService } from './billing.service';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { Tier, TIER_NAMES, displayLimit } from '../../../core/tier/tier-limits';
import { PLAN_CARDS, formatPlanPrice } from '../../../core/tier/tier-plans';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-billing',
  templateUrl: './billing.component.html',
  imports: [DatePipe, SkeletonComponent, PageHeaderComponent],
})
export class BillingComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _billing = inject(BillingService);
  private readonly _confirm = inject(ConfirmDialogService);

  // All three plans are paid — Standard, Pro, Scale. No free tier.
  protected readonly plans = PLAN_CARDS;
  protected readonly tierNames = TIER_NAMES;
  protected readonly formatPlanPrice = formatPlanPrice;

  protected readonly access = this._billing.access;
  protected readonly loading = this._billing.loading;
  protected readonly acting = this._billing.acting;

  protected readonly currentTier = computed<Tier>(() => (this.access()?.tier ?? 0) as Tier);
  protected readonly isTrialing = computed(() => this.access()?.isTrialing ?? false);
  protected readonly status = computed(() => this.access()?.status ?? null);

  // A scheduled downgrade/cancellation that takes effect at endsAt. pendingTier
  // is null when no change is scheduled; 0 means a scheduled cancellation.
  protected readonly pendingTier = computed<Tier | null>(() => this.access()?.pendingTier ?? null);
  protected readonly endsAt = computed<string | null>(() => this.access()?.endsAt ?? null);

  protected readonly salonLimitLabel = computed(() => displayLimit(this.access()?.salonLimit ?? 0));
  protected readonly staffLimitLabel = computed(() => displayLimit(this.access()?.staffLimit ?? 0));

  private get _orgId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.ORG_ID) ?? '';
  }

  ngOnInit(): void {
    this._billing.load(this._orgId);
  }

  // No live paid plan: still trialing, or lapsed. Branches on status, never on
  // the tier number (trial reads as 3).
  protected readonly needsPlan = computed(() => {
    const status = this.status();
    return this.isTrialing() || status === 'EXPIRED' || status === 'CANCELLED';
  });

  /** Access already lost — trial/plan ended with nothing live replacing it. */
  protected readonly hasLapsed = computed(() => {
    const status = this.status();
    return !this.isTrialing() && (status === 'EXPIRED' || status === 'CANCELLED');
  });

  // Upgrade = immediate (checkout -> verify -> re-fetch), offered whenever
  // there's no live plan. Was `isTrialing() ? 'upgrade' : 'current'`, which
  // left EXPIRED users with no buyable button at all.
  //
  // Once a plan IS live, no plan-switching is offered — changes go through
  // cancel + a fresh purchase. Downgrade stays disabled app-wide (backend
  // doesn't bill the lower tier correctly at period end).
  protected actionFor(_tier: Tier): 'current' | 'upgrade' | 'downgrade' {
    return this.needsPlan() ? 'upgrade' : 'current';
  }

  protected upgrade(tier: Tier): void {
    this._billing.upgrade(this._orgId, tier);
  }

  protected downgrade(tier: Tier): void {
    this._confirm
      .open({
        title: `Downgrade to ${this.tierNames[tier]}?`,
        message: `You'll keep your current plan until the end of your billing period, then move to ${this.tierNames[tier]}. Salons or staff over the new limit will be frozen, not deleted.`,
        confirmLabel: 'Schedule downgrade',
        danger: false,
      })
      .subscribe((ok) => {
        if (ok) this._billing.downgrade(this._orgId, tier);
      });
  }

  protected cancelPlan(): void {
    this._confirm
      .open({
        title: 'Cancel your plan?',
        message:
          'You keep full access until the end of your current billing period, then your plan ends. No data is deleted.',
        confirmLabel: 'Cancel plan',
        danger: true,
      })
      .subscribe((ok) => {
        if (ok) this._billing.cancel(this._orgId);
      });
  }
}
