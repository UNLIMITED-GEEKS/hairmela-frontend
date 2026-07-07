import { inject } from '@angular/core';
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

      // No socket connect here — QueueConsoleService and SalonVisitService
      // each connect() themselves (idempotent) right before they actually
      // watch a queue, so nothing needs a socket opened speculatively on
      // every boot. Keeps socket.io-client out of this bundle entirely for
      // sessions that restore but never touch a queue page.

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
