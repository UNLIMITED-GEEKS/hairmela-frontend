import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BillingService } from './billing.service';
import { ToastService } from '../../../core/toast/toast.service';
import { RouteParam, RouteQueryParam, RoutePath } from '../../../core/routing/route-paths';

// Landing route Flutterwave redirects to once checkout finishes (successful,
// cancelled, or failed) — this is the `redirect_url` the backend sets when
// creating the checkout session, built per-org: /org/:orgId/billing/payment/callback.
// Flutterwave appends ?status=&tx_ref=&transaction_id=; tx_ref is the same
// reference returned by checkout() and expected by /verify. Only a `status`
// of `successful` is worth verifying — `cancelled`/`failed` have nothing to
// confirm server-side, so we skip straight back to billing with a toast.
@Component({
  selector: 'app-payment-callback',
  templateUrl: './payment-callback.component.html',
})
export class PaymentCallbackComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _billing = inject(BillingService);
  private readonly _toast = inject(ToastService);

  private get _orgId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.ORG_ID) ?? '';
  }

  ngOnInit(): void {
    const orgId = this._orgId;
    const status = this._route.snapshot.queryParamMap.get(RouteQueryParam.STATUS);
    const txRef = this._route.snapshot.queryParamMap.get(RouteQueryParam.TX_REF);

    if (!orgId || !txRef || status !== 'successful') {
      if (status === 'cancelled') this._toast.error('Payment cancelled.');
      else if (status === 'failed') this._toast.error('Payment failed. Please try again.');
      this._router.navigate(RoutePath.orgBilling(orgId));
      return;
    }

    this._billing.verify(orgId, txRef).subscribe({
      next: () => {
        this._toast.success('Payment confirmed — your plan is active.');
      },
      error: () => {
        // verify() is a fast-path UX confirmation, not the source of truth —
        // the provider's webhook activates the tier independently, so this
        // isn't necessarily a real failure from the user's POV. No error
        // toast; the delayed refresh below picks up the real state once the
        // webhook lands.
      },
    });
    // Scheduled unconditionally (success or failure above) — the webhook can
    // land a few seconds after this call either way.
    this._billing.scheduleDelayedRefresh(orgId);
    this._router.navigate(RoutePath.orgBilling(orgId));
  }
}
