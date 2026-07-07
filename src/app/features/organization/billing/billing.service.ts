import { CacheRegistry } from '../../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, switchMap, tap, map } from 'rxjs';
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
import { OptimisticService } from '../../../core/optimistic/optimistic.service';
import { CachedLoader } from '../../../core/optimistic/cached-loader';

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _toast = inject(ToastService);
  private readonly _optimistic = inject(OptimisticService);

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

  // Start a checkout session. With the current dummy provider there's no real
  // payment page — the caller proceeds straight to verify(). With a real
  // provider you'd redirect the user to session.checkoutUrl first.
  checkout(orgId: string, tier: Tier): Observable<CheckoutSessionDto> {
    return subscriptionsControllerCheckout(this._http, this._apiConfig.rootUrl, {
      orgId,
      body: { tier },
    }).pipe(map((res) => res.body));
  }

  // Confirm + activate. Upgrades are IMMEDIATE — on success the org is on the
  // new tier and frozen salons un-freeze, so we invalidate the membership
  // cache and re-load access (handoff §4c).
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

  // Convenience: full upgrade flow for the dummy provider (checkout → verify).
  upgrade(orgId: string, tier: Tier, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    this.checkout(orgId, tier)
      .pipe(
        switchMap((session) =>
          subscriptionsControllerVerify(this._http, this._apiConfig.rootUrl, {
            orgId,
            body: { reference: session.reference },
          }).pipe(map((res) => res.body)),
        ),
      )
      .subscribe({
        next: () => {
          this._onSubscriptionChanged(orgId);
          this._toast.success('Plan upgraded.');
          onSuccess?.();
        },
        error: () => this._acting.set(false),
      });
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
