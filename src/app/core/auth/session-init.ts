import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TokenStore } from './token.store';
import { CurrentUserStore } from './current-user.store';
import { ApiConfiguration } from '../../api/api-configuration';
import { QueueSocketService } from '../socket/queue-socket.service';
import { GuestStore } from '../guest/guest-store';
import { authenticatedAuthControllerGetMe } from '../../api/fn/auth/authenticated-auth-controller-get-me';

// Gates BOTH the guest "resume where you left off" redirect and the
// logged-in "here's your dashboard" redirect below to once per session. Once
// either fires, a deliberate refresh (or clicking Home) while sitting at "/"
// no longer bounces the user away — it's a one-time landing nudge, not a
// standing rule that fires on every reload.
const ROOT_REDIRECT_KEY = 'hm_root_redirected';

export function sessionInit(): () => Promise<void> {
  return async () => {
    const http = inject(HttpClient);
    const tokenStore = inject(TokenStore);
    const currentUserStore = inject(CurrentUserStore);
    const apiConfig = inject(ApiConfiguration);
    const socketService = inject(QueueSocketService);
    const guestStore = inject(GuestStore);
    const router = inject(Router);

    // Boot check at root: redirect returning guests without a full page reload
    // cycle — but only once per session, so clicking Home and refreshing there
    // doesn't keep bouncing an active guest back to their queue position.
    if (window.location.pathname === '/' && !sessionStorage.getItem(ROOT_REDIRECT_KEY)) {
      if (guestStore.hasToken() && !tokenStore.getRefreshToken()) {
        sessionStorage.setItem(ROOT_REDIRECT_KEY, '1');
        router.navigateByUrl(guestStore.getLastPath());
        return;
      }
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
      socketService.connect();

      // Redirect to dashboard only on cold start at root, and only once per
      // session — otherwise a deliberate refresh while browsing the homepage
      // logged-in keeps yanking the user back to /dashboard.
      if (window.location.pathname === '/' && !sessionStorage.getItem(ROOT_REDIRECT_KEY)) {
        sessionStorage.setItem(ROOT_REDIRECT_KEY, '1');
        router.navigateByUrl('/dashboard');
      }
    } catch {
      tokenStore.clearTokens();
      currentUserStore.clear();
    }
  };
}
