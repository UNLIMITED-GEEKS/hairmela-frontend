import { DatePipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { EffectiveAccessDto } from '../../../../api/models/effective-access-dto';
import { PaymentStatusDto } from '../../../../api/models/payment-status-dto';
import { Tier, TIER_NAMES } from '../../../../core/tier/tier-limits';
import { PLAN_CARDS, formatPlanPrice } from '../../../../core/tier/tier-plans';
import { InlineSpinnerComponent } from '../../../../shared/components/inline-spinner/inline-spinner.component';

export type PrepaidDurationMonths = 1 | 3 | 6 | 12;

@Component({
  selector: 'app-bank-transfer-ui',
  templateUrl: './bank-transfer-ui.component.html',
  imports: [DatePipe, InlineSpinnerComponent],
})
export class BankTransferUiComponent {
  readonly access = input.required<EffectiveAccessDto>();
  readonly acting = input.required<boolean>();
  readonly checking = input<boolean>(false);
  readonly payment = input<PaymentStatusDto | null>(null);
  readonly checkout = output<{ tier: Tier; durationMonths: PrepaidDurationMonths }>();
  readonly checkStatus = output<void>();
  readonly cancel = output<void>();

  protected readonly plans = PLAN_CARDS;
  protected readonly tierNames = TIER_NAMES;
  protected readonly formatPlanPrice = formatPlanPrice;
  protected readonly durations: readonly PrepaidDurationMonths[] = [1, 3, 6, 12];
  protected readonly selectedTier = signal<Tier | null>(null);
  protected readonly selectedDuration = signal<PrepaidDurationMonths | null>(null);
  protected readonly activePrepaid = computed(
    () =>
      this.access().status === 'ACTIVE' && this.access().billingOption === 'PREPAID_BANK_TRANSFER',
  );
  protected readonly canCancel = computed(
    () => this.activePrepaid() && this.access().pendingTier === null,
  );
  protected readonly total = computed(() => {
    const tier = this.selectedTier();
    const duration = this.selectedDuration();
    const plan = this.plans.find((item) => item.tier === tier);
    return plan && duration ? plan.price * duration : null;
  });
  protected readonly canCheckout = computed(
    () => this.selectedTier() !== null && this.selectedDuration() !== null && !this.acting(),
  );

  protected selectTier(tier: Tier): void {
    if (!this.canSelect(tier)) return;
    this.selectedTier.set(tier);
    this.selectedDuration.set(null);
  }

  protected canSelect(tier: Tier): boolean {
    return !this.activePrepaid() || tier === this.access().tier;
  }

  protected startCheckout(): void {
    if (!this.canCheckout()) return;
    const tier = this.selectedTier();
    const durationMonths = this.selectedDuration();
    if (tier === null || durationMonths === null) return;
    this.checkout.emit({ tier, durationMonths });
  }

  protected formatTotal(amount: number): string {
    return `₦${amount.toLocaleString('en-NG')}`;
  }
}
