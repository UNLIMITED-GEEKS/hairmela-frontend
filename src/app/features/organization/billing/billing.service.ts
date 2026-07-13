import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, map } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { subscriptionsControllerGetMine } from '../../../api/fn/subscriptions/subscriptions-controller-get-mine';
import { subscriptionsControllerCheckout } from '../../../api/fn/subscriptions/subscriptions-controller-checkout';
import { subscriptionsControllerVerify } from '../../../api/fn/subscriptions/subscriptions-controller-verify';
import { subscriptionsControllerDowngrade } from '../../../api/fn/subscriptions/subscriptions-controller-downgrade';
import { subscriptionsControllerCancel } from '../../../api/fn/subscriptions/subscriptions-controller-cancel';
import { EffectiveAccessDto } from '../../../api/models/effective-access-dto';
import { CheckoutSessionDto } from '../../../api/models/checkout-session-dto';
import { Subscription } from '../../../api/models/subscription';
import { Tier } from '../../../core/tier/tier-limits';
import { MembershipStore } from '../../../core/salon-context/membership.store';
import { ToastService } from '../../../core/toast/toast.service';
import { OptimisticService } from '../../../core/caching/optimistic/optimistic.service';
import { CachedLoader } from '../../../core/caching/optimistic/cached-loader';
import { RoutePath } from '../../../core/routing/route-paths';

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _toast = inject(ToastService);
  private readonly _optimistic = inject(OptimisticService);
  private readonly _router = inject(Router);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _acting = signal(false);

  private readonly _cache = new Map<string, EffectiveAccessDto | null>();
  private readonly _access = signal<EffectiveAccessDto | null>(null);

  private readonly _loader = new CachedLoader({
    signal: this._access,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (orgId) =>
      subscriptionsControllerGetMine(this._http, this._apiConfig.rootUrl, { orgId }).pipe(
        map((r) => r.body as EffectiveAccessDto | null),
      ),
    // null here means "fetch failed to produce a value" — EffectiveAccessDto
    // itself is never null from a successful response, unlike the nested
    // fields on it (daysLeft, endsAt, etc.) which are legitimately nullable.
    shouldCache: (v) => v !== null,
  });

  readonly access = this._access.asReadonly();
  readonly loading = this._loader.loading;
  readonly acting = this._acting.asReadonly();

  // Current plan / effective access — drives the billing page (handoff §4b).
  load(orgId: string): void {
    this._loader.load(orgId);
  }

  refresh(orgId: string): void {
    this._loader.refresh(orgId);
  }

  // Start a checkout session. The backend creates it against the payment
  // provider (Flutterwave) with redirect_url already set to this org's
  // payment callback page (PaymentCallbackComponent) — the caller redirects
  // the browser to session.checkoutUrl to complete payment there.
  checkout(orgId: string, tier: Tier): Observable<CheckoutSessionDto> {
    return subscriptionsControllerCheckout(this._http, this._apiConfig.rootUrl, {
      orgId,
      body: { tier },
    }).pipe(map((res) => res.body));
  }

  // Confirm + activate. Called from PaymentCallbackComponent once the
  // provider redirects back with a successful status. Upgrades are IMMEDIATE —
  // on success the org is on the new tier and frozen salons un-freeze, so we
  // invalidate the membership cache and re-load access (handoff §4c).
  verify(orgId: string, reference: string): Observable<Subscription> {
    this._acting.set(true);
    return subscriptionsControllerVerify(this._http, this._apiConfig.rootUrl, {
      orgId,
      body: { reference },
    }).pipe(
      map((res) => res.body),
      tap(() => this._onSubscriptionChanged(orgId)),
    );
  }

  // Shared handling for wherever Flutterwave lands the browser after checkout
  // (normally /org/:orgId/billing/payment/callback, but subscription/Payment
  // Plan checkouts have been observed ignoring redirect_url and landing on
  // the bare domain root instead — LandingComponent detects that case and
  // calls this with an orgId parsed out of tx_ref). Only a `status` of
  // `successful` is worth verifying — `cancelled`/`failed` have nothing to
  // confirm server-side, so we just toast and redirect back to billing.
  handlePaymentReturn(orgId: string, status: string | null, txRef: string | null): void {
    if (!orgId || !txRef || status !== 'successful') {
      if (status === 'cancelled') this._toast.error('Payment cancelled.');
      else if (status === 'failed') this._toast.error('Payment failed. Please try again.');
      this._router.navigate(RoutePath.orgBilling(orgId));
      return;
    }

    this.verify(orgId, txRef).subscribe({
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
    this.scheduleDelayedRefresh(orgId);
    this._router.navigate(RoutePath.orgBilling(orgId));
  }

  // Start an upgrade: create the checkout session, then send the browser to
  // the provider's payment page. Verification happens later, when the
  // provider redirects back to PaymentCallbackComponent (or, for Payment Plan
  // checkouts, wherever Flutterwave actually lands the browser).
  upgrade(orgId: string, tier: Tier): void {
    if (this._acting()) return;
    this._acting.set(true);
    this.checkout(orgId, tier).subscribe({
      next: (session) => {
        window.location.href = session.checkoutUrl;
      },
      error: () => this._acting.set(false),
    });
  }

  // The payment provider's webhook — not verify() — is the real source of
  // truth for activating a tier; it can land a few seconds after the
  // checkout redirect. Called from PaymentCallbackComponent after a
  // successful payment status, regardless of whether verify() itself
  // succeeded, so the UI doesn't get stuck on a stale tier if verify failed
  // (or never ran) but the webhook still activated it.
  scheduleDelayedRefresh(orgId: string): void {
    setTimeout(() => this.refresh(orgId), 6000);
  }

  // Schedule a downgrade at period end — NOT immediate (handoff §4d).
  downgrade(orgId: string, tier: Tier, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    subscriptionsControllerDowngrade(this._http, this._apiConfig.rootUrl, {
      orgId,
      body: { tier },
    }).subscribe({
      next: () => {
        this._onSubscriptionChanged(orgId);
        this._toast.success('Downgrade scheduled for the end of your billing period.');
        onSuccess?.();
      },
      error: () => this._acting.set(false),
    });
  }

  // Schedule cancellation at period end — NOT immediate (handoff §4e).
  cancel(orgId: string, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    subscriptionsControllerCancel(this._http, this._apiConfig.rootUrl, { orgId }).subscribe({
      next: () => {
        this._onSubscriptionChanged(orgId);
        this._toast.success('Your plan will end at the close of the current billing period.');
        onSuccess?.();
      },
      error: () => this._acting.set(false),
    });
  }

  // After any subscription change: membership tier/freeze state is now stale,
  // so drop the cache and re-load the billing view from the fresh truth.
  private _onSubscriptionChanged(orgId: string): void {
    this._membershipStore.invalidateAll();
    this._acting.set(false);
    this.refresh(orgId);
  }

  clear(): void {
    this._cache.clear();
    this._optimistic.reset(this._access, null);
  }
}
