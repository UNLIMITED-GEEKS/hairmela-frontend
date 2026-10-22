import {
  EMPTY,
  Observable,
  Subscription as RxSubscription,
  catchError,
  filter,
  finalize,
  map,
  switchMap,
  takeUntil,
  tap,
  timer,
} from 'rxjs';
import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';
import { Injectable, inject, signal, effect, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { ApiConfiguration } from '../../../api/api-configuration';
import { subscriptionsControllerGetMine } from '../../../api/fn/subscriptions/subscriptions-controller-get-mine';
import { subscriptionsControllerCheckout } from '../../../api/fn/subscriptions/subscriptions-controller-checkout';
import { subscriptionsControllerVerify } from '../../../api/fn/subscriptions/subscriptions-controller-verify';
import { subscriptionsControllerDowngrade } from '../../../api/fn/subscriptions/subscriptions-controller-downgrade';
import { subscriptionsControllerCancel } from '../../../api/fn/subscriptions/subscriptions-controller-cancel';
import { subscriptionsControllerGetPaymentStatus } from '../../../api/fn/subscriptions/subscriptions-controller-get-payment-status';
import { EffectiveAccessDto } from '../../../api/models/effective-access-dto';
import { CheckoutSessionDto } from '../../../api/models/checkout-session-dto';
import { Subscription } from '../../../api/models/subscription';
import { PaymentStatusDto } from '../../../api/models/payment-status-dto';
import { Tier } from '../../../core/tier/tier-limits';
import { MembershipStore } from '../../../core/salon-context/membership.store';
import { OrgContextService } from '../../../core/salon-context/org-context.service';
import { ToastService } from '../../../core/toast/toast.service';
import { OptimisticService } from '../../../core/caching/optimistic/optimistic.service';
import { CachedLoader } from '../../../core/caching/optimistic/cached-loader';
import { RoutePath } from '../../../core/routing/route-paths';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { AppResumeService } from '../../../core/native/app-resume.service';
import { IapOffer, IapService } from '../../../core/native/iap.service';
import { PersistentStore } from '../../../core/storage/persistent-store';

type BillingOption = 'RECURRING_CARD' | 'PREPAID_BANK_TRANSFER';
type PrepaidDurationMonths = 1 | 3 | 6 | 12;

interface PendingBankTransfer {
  orgId: string;
  reference: string;
  status: PaymentStatusDto['status'];
}

const PENDING_BANK_TRANSFER_KEY = 'hm_pending_bank_transfer';

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _orgContext = inject(OrgContextService);
  private readonly _toast = inject(ToastService);
  private readonly _optimistic = inject(OptimisticService);
  private readonly _router = inject(Router);
  private readonly _platform = inject(AppPlatformService);
  private readonly _appResume = inject(AppResumeService);
  private readonly _persistentStore = inject(PersistentStore);
  private readonly _iap = inject(IapService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _acting = signal(false);
  private readonly _bankTransferPayment = signal<PaymentStatusDto | null>(null);
  private readonly _checkingBankTransfer = signal(false);
  private _bankTransferPolling?: RxSubscription;

  // Releases the acting lock whenever the app returns to the foreground.
  //
  // handlePaymentReturn covers every path where the provider actually
  // redirects back, but not the user simply backing out of the browser — that
  // sends no callback at all, so nothing ran to clear the flag and Upgrade
  // stayed on "Working…" until the page was reloaded.
  //
  // Blunt on purpose: it does not ask WHY the app resumed. Clearing when
  // nothing was pending is a no-op, and a resume that IS a completed payment
  // re-sets the flag a moment later via verify(). No-op on web, where
  // AppResumeService never fires.
  //
  // A field initializer rather than the constructor above: this reads
  // _acting, which is declared on the line above and would still be
  // undefined at constructor time.
  private readonly _releaseOnResume = effect(() => {
    this._appResume.resumed();
    untracked(() => this._acting.set(false));
  });

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
  private readonly _iapOffers = signal<readonly IapOffer[]>([]);
  readonly iapOffers = this._iapOffers.asReadonly();
  private readonly _iapStatus = signal<'loading' | 'ready' | 'unavailable'>('loading');
  readonly iapStatus = this._iapStatus.asReadonly();
  private readonly _iapDetail = signal<string | null>(null);
  readonly iapDetail = this._iapDetail.asReadonly();
  readonly bankTransferPayment = this._bankTransferPayment.asReadonly();
  readonly checkingBankTransfer = this._checkingBankTransfer.asReadonly();

  // Current plan / effective access — drives the billing page (handoff §4b).
  //
  // Seeds this loader's OWN cache from OrgContextService when it's already
  // warm (that service fetches the identical EffectiveAccessDto — same
  // subscriptionsControllerGetMine call — as a side effect of resolving
  // ownedOrg, e.g. via orgOwnerGuard just before this component mounts). A
  // user owns at most one org, so ownedOrg().id === orgId is sufficient proof
  // that access() genuinely belongs to THIS org, not a stale read from a
  // previously-viewed one. Without this seed, landing on the billing page
  // re-fetched the same data a moment after the guard's own fetch already
  // had it — a third redundant request stacked onto an otherwise-instant
  // Upgrade click on prod. CachedLoader.load() already checks its cache map
  // before ever calling fetch(), so seeding the map is all that's needed —
  // no beginRead/commitRead bookkeeping to duplicate here.
  load(orgId: string): void {
    const org = this._orgContext.ownedOrg();
    const access = this._orgContext.access();
    if (org?.id === orgId && access && !this._cache.has(orgId)) {
      this._cache.set(orgId, access);
    }
    this._loader.load(orgId);
  }

  refresh(orgId: string): void {
    this._loader.refresh(orgId);
  }

  // Start a checkout session. The backend creates it against the payment
  // provider (Flutterwave) and owns which redirect_url it sets — the caller
  // sends the browser to session.checkoutUrl to complete payment there.
  //
  // `native` tells the backend WHICH redirect_url to use. On the web an https
  // callback is right, but in the app it is not: the checkout page opens
  // outside the WebView, and an https return either renders as an ordinary web
  // page or depends on Android App Link verification holding — so the user can
  // pay and never get back to the app. For a native checkout the backend sends
  // an app-scheme redirect_url instead, which only this app can handle and so
  // always returns to it (see DeepLinkService and the hairmela:// intent
  // filter in AndroidManifest.xml).
  checkout(
    orgId: string,
    tier: Tier,
    billingOption: BillingOption = 'RECURRING_CARD',
    durationMonths?: PrepaidDurationMonths,
  ): Observable<CheckoutSessionDto> {
    return subscriptionsControllerCheckout(this._http, this._apiConfig.rootUrl, {
      orgId,
      body: { tier, native: this._platform.isNative, billingOption, durationMonths },
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
    // Release the lock upgrade() took before sending the user to the provider.
    // On the web it never needed releasing — assigning location.href tore the
    // app down, so the flag died with it. In the app the process stays alive
    // across checkout and comes back with the flag still set, leaving Upgrade
    // stuck on "Working…" after a cancelled or failed payment. Cleared here
    // rather than in each branch below because this method is the one funnel
    // every return passes through, whatever the outcome.
    this._acting.set(false);

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
        //
        // The lock DOES have to be released though: verify() set it, and only
        // its success path (_onSubscriptionChanged) clears it. Without this a
        // failed verify leaves Upgrade stuck on "Working…" in the app, where
        // the process survives checkout — the same reason the flag is cleared
        // at the top of this method.
        this._acting.set(false);
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

  startBankTransfer(orgId: string, tier: Tier, durationMonths: PrepaidDurationMonths): void {
    if (this._acting()) return;
    this._acting.set(true);
    this.checkout(orgId, tier, 'PREPAID_BANK_TRANSFER', durationMonths).subscribe({
      next: (session) => {
        this._saveBankTransfer({ orgId, reference: session.reference, status: 'PENDING' });
        window.location.href = session.checkoutUrl;
      },
      error: () => this._acting.set(false),
    });
  }

  resumeBankTransferStatus(orgId: string): void {
    const pending = this._pendingBankTransfer();
    if (!pending || pending.orgId !== orgId) {
      this._bankTransferPayment.set(null);
      return;
    }

    this._bankTransferPayment.set({ reference: pending.reference, status: pending.status });
    if (pending.status === 'PENDING') this._pollBankTransfer(orgId, pending.reference);
  }

  checkBankTransferStatus(orgId: string): void {
    const pending = this._pendingBankTransfer();
    if (!pending || pending.orgId !== orgId) return;
    this._checkingBankTransfer.set(true);
    this._fetchBankTransferStatus(orgId, pending.reference)
      .pipe(finalize(() => this._checkingBankTransfer.set(false)))
      .subscribe((payment) => {
        this._handleBankTransferStatus(orgId, payment);
      });
  }

  // The payment provider's webhook — not verify() — is the real source of
  // truth for activating a tier; it can land a few seconds after the
  // checkout redirect. Called from PaymentCallbackComponent after a
  // successful payment status, regardless of whether verify() itself
  // succeeded, so the UI doesn't get stuck on a stale tier if verify failed
  // (or never ran) but the webhook still activated it.
  // iOS: plans are bought through Apple, not the web checkout. The backend
  // learns of a purchase from RevenueCat's webhook, so the plan flips a moment
  // after Apple's sheet closes — see _refreshAfterIap.
  loadIapOffers(orgId: string): void {
    this._iapStatus.set('loading');
    this._iapDetail.set(null);
    this._iap.loadOffers(orgId).then(
      (offers) => {
        this._iapOffers.set(offers);
        this._iapStatus.set(offers.length ? 'ready' : 'unavailable');
      },
      (e: unknown) => {
        // The store's own message says WHY (e.g. products not ready), so keep it.
        this._iapDetail.set((e as { message?: string }).message ?? null);
        this._iapStatus.set('unavailable');
      },
    );
  }

  async purchaseIap(orgId: string, tier: Tier): Promise<void> {
    const offer = this._iapOffers().find((o) => o.tier === tier);
    if (!offer || this._acting()) return;
    this._acting.set(true);
    try {
      if (await this._iap.purchase(orgId, offer)) {
        this._toast.success('Purchase complete. Activating your plan…');
        this._refreshAfterIap(orgId);
      }
    } catch {
      this._toast.error('The purchase could not be completed. Please try again.');
    } finally {
      this._acting.set(false);
    }
  }

  async restoreIap(orgId: string): Promise<void> {
    if (this._acting()) return;
    this._acting.set(true);
    try {
      await this._iap.restore(orgId);
      this._toast.success('Purchases restored.');
      this._refreshAfterIap(orgId);
    } catch {
      this._toast.error('Could not restore purchases. Please try again.');
    } finally {
      this._acting.set(false);
    }
  }

  async manageIap(orgId: string): Promise<void> {
    try {
      window.location.href = await this._iap.managementUrl(orgId);
    } catch {
      this._toast.error('Could not open subscription settings. Please try again.');
    }
  }

  // Webhook latency: re-read the plan a few times instead of once.
  private _refreshAfterIap(orgId: string): void {
    for (const ms of [2000, 6000, 15000]) {
      setTimeout(() => this._onSubscriptionChanged(orgId), ms);
    }
  }

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
    this._bankTransferPolling?.unsubscribe();
    this._bankTransferPolling = undefined;
    this._bankTransferPayment.set(null);
    this._cache.clear();
    this._optimistic.reset(this._access, null);
  }

  // Clear only the locally-tracked pending bank transfer state (polling,
  // persisted reference and in-memory signal) without touching the access
  // cache or optimistic state. This allows the UI to stop treating the
  // org as in-bank-transfer mode while the pending payment still exists on
  // the provider; useful when a user explicitly wants to switch back to
  // card UI while a transfer is awaiting confirmation.
  clearPendingBankTransfer(): void {
    this._bankTransferPolling?.unsubscribe();
    this._bankTransferPolling = undefined;
    this._bankTransferPayment.set(null);
    this._persistentStore.remove(PENDING_BANK_TRANSFER_KEY);
  }

  private _pollBankTransfer(orgId: string, reference: string): void {
    this._bankTransferPolling?.unsubscribe();
    this._bankTransferPolling = timer(0, 5000)
      .pipe(
        // Avoid network work while the app is not visible. The timer remains
        // bounded to ten minutes; users can always press "Check status" later.
        filter(() => typeof document === 'undefined' || document.visibilityState === 'visible'),
        switchMap(() => this._fetchBankTransferStatus(orgId, reference)),
        takeUntil(timer(10 * 60 * 1000)),
      )
      .subscribe((payment) => {
        this._handleBankTransferStatus(orgId, payment);
        if (payment.status !== 'PENDING') this._bankTransferPolling?.unsubscribe();
      });
  }

  private _fetchBankTransferStatus(orgId: string, reference: string): Observable<PaymentStatusDto> {
    return subscriptionsControllerGetPaymentStatus(this._http, this._apiConfig.rootUrl, {
      orgId,
      reference,
    }).pipe(
      map((response) => response.body),
      // A temporary connection error must not turn a pending payment into a
      // failure or stop the remaining scheduled checks.
      catchError(() => EMPTY),
    );
  }

  private _handleBankTransferStatus(orgId: string, payment: PaymentStatusDto): void {
    this._bankTransferPayment.set(payment);
    this._saveBankTransfer({ orgId, reference: payment.reference, status: payment.status });
    if (payment.status !== 'CONFIRMED') return;

    this._persistentStore.remove(PENDING_BANK_TRANSFER_KEY);
    this._bankTransferPolling?.unsubscribe();
    this._bankTransferPolling = undefined;
    this._onSubscriptionChanged(orgId);
  }

  private _pendingBankTransfer(): PendingBankTransfer | null {
    return this._persistentStore.get<PendingBankTransfer>(PENDING_BANK_TRANSFER_KEY);
  }

  private _saveBankTransfer(payment: PendingBankTransfer): void {
    this._persistentStore.set(PENDING_BANK_TRANSFER_KEY, payment);
  }
}
