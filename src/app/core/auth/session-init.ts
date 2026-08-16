import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TokenStore } from './token.store';
import { CurrentUserStore } from './current-user.store';
import { ApiConfiguration } from '../../api/api-configuration';
import { GuestStore } from '../guest/guest-store';
import { authenticatedAuthControllerGetMe } from '../../api/fn/auth/authenticated-auth-controller-get-me';
import { PersistentStore } from '../storage/persistent-store';
import { LAST_SALON_KEY } from '../salon-context/salon-context.service';
import { RoutePath, RouteQueryParam } from '../routing/route-paths';

// True on a genuine fresh navigation to the app (typing the URL, following a
// link, opening a new tab) — but false on a page RELOAD/refresh. Lets the
// cold-start redirect below fire when a returning visitor first opens the app,
// while leaving them alone when they deliberately refresh at "/". Uses the
// Navigation Timing API rather than a sessionStorage flag, because navigating
// inside the app initializer wipes sessionStorage (trivial-history pushState→
// replaceState), so a flag never survives to gate the next load.
function isFreshNavigation(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    // Only 'navigate' should redirect. 'reload' (refresh) and 'back_forward'
    // (history nav) must not bounce the user away from where they chose to be.
    return !nav || nav.type === 'navigate';
  } catch {
    return true;
  }
}

export function sessionInit(): () => Promise<void> {
  return async () => {
    const http = inject(HttpClient);
    const tokenStore = inject(TokenStore);
    const currentUserStore = inject(CurrentUserStore);
    const apiConfig = inject(ApiConfiguration);
    const guestStore = inject(GuestStore);
    const router = inject(Router);
    const persistentStore = inject(PersistentStore);

    // Native only: load Capacitor Preferences into PersistentStore's
    // synchronous cache before ANY read below. Awaited HERE rather than relying
    // on a separate provideAppInitializer running first — Angular starts all
    // initializers in parallel and only waits for them collectively, so
    // ordering them in the providers array guarantees nothing. Without this
    // await, getRefreshToken() below reads an empty cache while hydration is
    // still in flight and every native cold start looks signed-out.
    // Idempotent and a no-op on web.
    await persistentStore.hydrate();

    const atRoot = window.location.pathname === '/';
    // Flutterwave's redirect_url is set to the org's payment-callback page,
    // but subscription/Payment Plan checkouts have been observed ignoring
    // that and landing on the bare root instead, with ?status=&tx_ref=
    // appended. When that's the case, don't redirect away from "/" here —
    // LandingComponent needs to actually mount so it can detect those params
    // and run the payment verification flow (see its _handlePaymentReturnIfPresent).
    const hasPaymentReturnParams = new URLSearchParams(window.location.search).has(RouteQueryParam.TX_REF);
    const shouldRedirect = atRoot && isFreshNavigation() && !hasPaymentReturnParams;

    // Fresh load at root as a returning guest → back to their queue.
    if (shouldRedirect && guestStore.hasToken() && !tokenStore.getRefreshToken()) {
      router.navigateByUrl(guestStore.getLastPath());
      return;
    }

    const refreshToken = tokenStore.getRefreshToken();
    if (!refreshToken) return;

    try {
      const tokens = await firstValueFrom(
        http.post<{ accessToken: string; refreshToken: string }>(
          `${apiConfig.rootUrl}/v1/auth/refresh`,
          { refreshToken },
        )
      );
      tokenStore.setTokens(tokens.accessToken, tokens.refreshToken);

      const userResponse = await firstValueFrom(
        authenticatedAuthControllerGetMe(http, apiConfig.rootUrl, {})
      );
      currentUserStore.set(userResponse.body);

      // No socket connect here — QueueConsoleService and SalonVisitService
      // each connect() themselves (idempotent) right before they actually
      // watch a queue, so nothing needs a socket opened speculatively on
      // every boot. Keeps socket.io-client out of this bundle entirely for
      // sessions that restore but never touch a queue page.

      // Fresh load at root as a logged-in user → their last-visited salon if
      // one is persisted (no fetch — salonRoleGuard validates it downstream),
      // else the dashboard. NOT on a refresh.
      if (shouldRedirect) {
        const lastId = persistentStore.get<string>(LAST_SALON_KEY);
        router.navigate(lastId ? RoutePath.salon(lastId) : RoutePath.dashboard());
      }
    } catch {
      tokenStore.clearTokens();
      currentUserStore.clear();
    }
  };
}
