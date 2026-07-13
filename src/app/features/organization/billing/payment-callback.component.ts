import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BillingService } from './billing.service';
import { RouteParam, RouteQueryParam } from '../../../core/routing/route-paths';

// Landing route Flutterwave redirects to once checkout finishes (successful,
// cancelled, or failed) — this is the `redirect_url` the backend sets when
// creating the checkout session, built per-org: /org/:orgId/billing/payment/callback.
// Flutterwave appends ?status=&tx_ref=&transaction_id=; tx_ref is the same
// reference returned by checkout() and expected by /verify. Subscription/
// Payment Plan checkouts have been observed ignoring redirect_url entirely
// and landing on the bare domain root instead — see LandingComponent, which
// detects that case and calls the same BillingService.handlePaymentReturn().
@Component({
  selector: 'app-payment-callback',
  templateUrl: './payment-callback.component.html',
})
export class PaymentCallbackComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _billing = inject(BillingService);

  private get _orgId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.ORG_ID) ?? '';
  }

  ngOnInit(): void {
    const status = this._route.snapshot.queryParamMap.get(RouteQueryParam.STATUS);
    const txRef = this._route.snapshot.queryParamMap.get(RouteQueryParam.TX_REF);
    this._billing.handlePaymentReturn(this._orgId, status, txRef);
  }
}
