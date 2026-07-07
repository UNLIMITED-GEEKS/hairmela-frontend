import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TokenStore } from './token.store';
import { CurrentUserStore } from './current-user.store';
import { ApiConfiguration } from '../../api/api-configuration';
import { GuestStore } from '../guest/guest-store';
import { authenticatedAuthControllerGetMe } from '../../api/fn/auth/authenticated-auth-controller-get-me';

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
    // Captured here (in the initializer's injection context) so we can resolve
    // QueueSocketService later, after lazy-loading it below — this keeps
    // socket.io-client out of the initial main.js bundle entirely.
    const injector = inject(EnvironmentInjector);

    const atRoot = window.location.pathname === '/';
    const shouldRedirect = atRoot && isFreshNavigation();

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

      // Lazy-load socket.io only now that we have a signed-in user — it's in
      // its own chunk, so the marketing/auth pages never download it. Not
      // awaited: connect() is fire-and-forget and must not delay the redirect
      // below or block the initializer from resolving.
      void import('../socket/queue-socket.service').then(({ QueueSocketService }) => {
        runInInjectionContext(injector, () => inject(QueueSocketService)).connect();
      });

      // Fresh load at root as a logged-in user → dashboard. NOT on a refresh.
      if (shouldRedirect) {
        router.navigateByUrl('/dashboard');
      }
    } catch {
      tokenStore.clearTokens();
      currentUserStore.clear();
    }
  };
}
