import { Injectable, inject } from '@angular/core';
import type { PurchasesPackage } from '@revenuecat/purchases-capacitor';
import { environment } from '../../../environments/environment';
import { Tier } from '../tier/tier-limits';
import { AppPlatformService } from './app-platform.service';

// Apple in-app purchase for the iOS app, via RevenueCat.
//
// The org is the customer: RevenueCat's appUserID is the org id, so the
// RevenueCat webhook tells the backend which org to upgrade. The plan therefore
// flips a moment AFTER a purchase completes — callers refresh, they don't
// assume.
//
// The plugin sits behind a dynamic import() so a web build never ships it —
// the rule AppUpdateService documents. `import type` above is erased and costs
// nothing. Do not convert the dynamic import to a static one.

/** App Store Connect product id → the tier it grants. Must match the products
 *  created in App Store Connect / RevenueCat. */
const IAP_PRODUCT_TIER: Record<string, Tier> = {
  hairmela_standard_monthly: 1,
  hairmela_pro_monthly: 2,
  hairmela_scale_monthly: 3,
};

const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

export interface IapOffer {
  readonly tier: Tier;
  /** StoreKit's localized price, e.g. "₦2,900.00". Never hardcode prices. */
  readonly price: string;
  readonly pkg: PurchasesPackage;
}

@Injectable({ providedIn: 'root' })
export class IapService {
  private readonly _platform = inject(AppPlatformService);
  private _configuredFor: string | null = null;

  async loadOffers(orgId: string): Promise<IapOffer[]> {
    const purchases = await this._ready(orgId);
    const { current } = await purchases.getOfferings();
    return (current?.availablePackages ?? []).flatMap((pkg) => {
      const tier = IAP_PRODUCT_TIER[pkg.product.identifier];
      return tier ? [{ tier, price: pkg.product.priceString, pkg }] : [];
    });
  }

  /** Resolves true once bought, false if the user backed out of the Apple sheet. */
  async purchase(orgId: string, offer: IapOffer): Promise<boolean> {
    const purchases = await this._ready(orgId);
    try {
      await purchases.purchasePackage({ aPackage: offer.pkg });
      return true;
    } catch (e) {
      if ((e as { userCancelled?: boolean }).userCancelled) return false;
      throw e;
    }
  }

  async restore(orgId: string): Promise<void> {
    const purchases = await this._ready(orgId);
    await purchases.restorePurchases();
  }

  async managementUrl(orgId: string): Promise<string> {
    const purchases = await this._ready(orgId);
    const { customerInfo } = await purchases.getCustomerInfo();
    return customerInfo.managementURL ?? APPLE_SUBSCRIPTIONS_URL;
  }

  // Configures once, then re-identifies if a different org is ever billed from
  // the same session.
  private async _ready(orgId: string) {
    if (this._platform.billingMode !== 'iap' || !environment.revenueCatIosApiKey) {
      throw new Error('In-app purchase is not available in this build.');
    }
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    if (this._configuredFor === null) {
      await Purchases.configure({ apiKey: environment.revenueCatIosApiKey, appUserID: orgId });
    } else if (this._configuredFor !== orgId) {
      await Purchases.logIn({ appUserID: orgId });
    }
    this._configuredFor = orgId;
    return Purchases;
  }
}
