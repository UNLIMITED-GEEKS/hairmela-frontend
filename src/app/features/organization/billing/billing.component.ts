import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BillingService } from './billing.service';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { IapPaymentUiComponent } from './iap-payment-ui/iap-payment-ui.component';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { Tier } from '../../../core/tier/tier-limits';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteParam } from '../../../core/routing/route-paths';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { CardPaymentUiComponent } from './card-payment-ui/card-payment-ui.component';
import {
  BankTransferUiComponent,
  PrepaidDurationMonths,
} from './bank-transfer-ui/bank-transfer-ui.component';

@Component({
  selector: 'app-billing',
  templateUrl: './billing.component.html',
  imports: [
    SkeletonComponent,
    PageHeaderComponent,
    CardPaymentUiComponent,
    BankTransferUiComponent,
    IapPaymentUiComponent,
  ],
})
export class BillingComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _billing = inject(BillingService);
  private readonly _confirm = inject(ConfirmDialogService);
  protected readonly isIap = inject(AppPlatformService).billingMode === 'iap';

  protected readonly access = this._billing.access;
  protected readonly loading = this._billing.loading;
  protected readonly acting = this._billing.acting;
  protected readonly bankTransferPayment = this._billing.bankTransferPayment;
  protected readonly checkingBankTransfer = this._billing.checkingBankTransfer;
  protected readonly iapOffers = this._billing.iapOffers;
  protected readonly iapStatus = this._billing.iapStatus;
  protected readonly iapDetail = this._billing.iapDetail;
  private readonly _selectedPaymentMode = signal<'card' | 'bank'>('card');

  // Active subscriptions determine their own UI. A trial or ended plan has no
  // billing option, so it starts on card and can opt into prepaid transfer.
  protected readonly paymentMode = computed<'card' | 'bank'>(() => {
    const access = this.access();
    if (access?.status === 'ACTIVE') {
      return access.billingOption === 'PREPAID_BANK_TRANSFER' ? 'bank' : 'card';
    }
    if (this.bankTransferPayment()) return 'bank';
    return this._selectedPaymentMode();
  });
  protected readonly canSwitchToBank = computed(() => {
    const access = this.access();
    return !(
      access?.status === 'ACTIVE' &&
      (access.billingOption === 'RECURRING_CARD' || access.billingOption === 'APPLE_IAP')
    );
  });
  // Bought in the iOS app: Apple bills it, so the web can't cancel or change it.
  protected readonly billedByApple = computed(() => {
    const access = this.access();
    return access?.status === 'ACTIVE' && access.billingOption === 'APPLE_IAP';
  });
  protected readonly canSwitchToCard = computed(() => {
    const access = this.access();
    return !(access?.status === 'ACTIVE' && access.billingOption === 'PREPAID_BANK_TRANSFER');
  });

  private get _orgId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.ORG_ID) ?? '';
  }

  ngOnInit(): void {
    this._billing.load(this._orgId);
    if (this.isIap) this._billing.loadIapOffers(this._orgId);
    this._billing.resumeBankTransferStatus(this._orgId);
  }

  protected upgrade(tier: Tier): void {
    this._billing.upgrade(this._orgId, tier);
  }

  protected retryIap(): void {
    this._billing.loadIapOffers(this._orgId);
  }

  protected purchaseIap(tier: Tier): void {
    this._billing.purchaseIap(this._orgId, tier);
  }

  protected restoreIap(): void {
    this._billing.restoreIap(this._orgId);
  }

  protected manageIap(): void {
    this._billing.manageIap(this._orgId);
  }

  protected selectBankTransfer(): void {
    this._selectedPaymentMode.set('bank');
  }

  protected selectCardPayment(): void {
    // Clear any locally-tracked pending bank transfer so UI can switch
    // back to card mode immediately even if a transfer remains pending
    // with the provider.
    this._billing.clearPendingBankTransfer();
    this._selectedPaymentMode.set('card');
  }

  protected startBankTransfer({
    tier,
    durationMonths,
  }: {
    tier: Tier;
    durationMonths: PrepaidDurationMonths;
  }): void {
    this._billing.startBankTransfer(this._orgId, tier, durationMonths);
  }

  protected checkBankTransferStatus(): void {
    this._billing.checkBankTransferStatus(this._orgId);
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
