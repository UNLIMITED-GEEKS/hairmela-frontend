import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { EffectiveAccessDto } from '../../../../api/models/effective-access-dto';
import { Tier, TIER_NAMES, displayLimit } from '../../../../core/tier/tier-limits';
import { PLAN_CARDS, formatPlanPrice } from '../../../../core/tier/tier-plans';
import { InlineSpinnerComponent } from '../../../../shared/components/inline-spinner/inline-spinner.component';

@Component({
  selector: 'app-card-payment-ui',
  templateUrl: './card-payment-ui.component.html',
  imports: [DatePipe, InlineSpinnerComponent],
})
export class CardPaymentUiComponent {
  readonly access = input.required<EffectiveAccessDto>();
  readonly acting = input.required<boolean>();
  readonly billedByApple = input(false);
  readonly upgrade = output<Tier>();
  readonly cancel = output<void>();

  protected readonly plans = PLAN_CARDS;
  protected readonly tierNames = TIER_NAMES;
  protected readonly formatPlanPrice = formatPlanPrice;

  protected readonly currentTier = computed(() => this.access().tier as Tier);
  protected readonly isTrialing = computed(() => this.access().isTrialing);
  protected readonly needsPlan = computed(() => {
    const { isTrialing, status } = this.access();
    return isTrialing || status === 'EXPIRED' || status === 'CANCELLED';
  });
  protected readonly hasLapsed = computed(() => {
    const { isTrialing, status } = this.access();
    return !isTrialing && (status === 'EXPIRED' || status === 'CANCELLED');
  });
  protected readonly salonLimitLabel = computed(() => displayLimit(this.access().salonLimit));
  protected readonly staffLimitLabel = computed(() => displayLimit(this.access().staffLimit));
}
