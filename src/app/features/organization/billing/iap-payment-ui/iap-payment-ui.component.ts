import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EffectiveAccessDto } from '../../../../api/models/effective-access-dto';
import { IapOffer } from '../../../../core/native/iap.service';
import { RoutePath } from '../../../../core/routing/route-paths';
import { Tier, TIER_NAMES } from '../../../../core/tier/tier-limits';
import { PLAN_CARDS } from '../../../../core/tier/tier-plans';
import { InlineSpinnerComponent } from '../../../../shared/components/inline-spinner/inline-spinner.component';

// iOS billing UI: plans are bought through Apple in-app purchase. Prices come
// from StoreKit (offers), never from PLAN_CARDS, so they always match what
// Apple will charge. Only plans Apple returned are offered.
@Component({
  selector: 'app-iap-payment-ui',
  templateUrl: './iap-payment-ui.component.html',
  imports: [DatePipe, RouterLink, InlineSpinnerComponent],
})
export class IapPaymentUiComponent {
  readonly access = input.required<EffectiveAccessDto>();
  readonly offers = input.required<readonly IapOffer[]>();
  readonly acting = input.required<boolean>();
  readonly status = input.required<'loading' | 'ready' | 'unavailable'>();
  readonly detail = input<string | null>(null);
  readonly choose = output<Tier>();
  readonly restore = output<void>();
  readonly retry = output<void>();
  readonly manage = output<void>();

  protected readonly tierNames = TIER_NAMES;
  protected readonly termsLink = RoutePath.terms();
  protected readonly privacyLink = RoutePath.privacy();

  protected readonly currentTier = computed(() => this.access().tier as Tier);
  protected readonly isTrialing = computed(() => this.access().isTrialing);
  protected readonly needsPlan = computed(() => {
    const { isTrialing, status } = this.access();
    return isTrialing || status === 'EXPIRED' || status === 'CANCELLED';
  });
  // An active plan bought outside the app (the web). Apple can't manage it, and
  // App Review forbids pointing users to another way to pay, so the UI only
  // says it isn't App Store billing — no link, no mention of the website.
  protected readonly billedElsewhere = computed(() => {
    const { status, billingOption } = this.access();
    return status === 'ACTIVE' && billingOption !== 'APPLE_IAP';
  });
  protected readonly hasLapsed = computed(() => {
    const { isTrialing, status } = this.access();
    return !isTrialing && (status === 'EXPIRED' || status === 'CANCELLED');
  });

  protected readonly plans = computed(() =>
    PLAN_CARDS.flatMap((plan) => {
      const offer = this.offers().find((o) => o.tier === plan.tier);
      return offer ? [{ ...plan, price: offer.price }] : [];
    }),
  );
}
