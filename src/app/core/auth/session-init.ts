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

// Once this fires, a deliberate refresh while sitting at "/" (e.g. browsing
// the homepage while logged in) won't bounce the user to /dashboard again —
// the redirect is a one-time "you're signed in, here's your dashboard" nudge
// per session, not a standing rule that fights every reload.
const DASHBOARD_REDIRECT_KEY = 'hm_dashboard_redirected';

export function sessionInit(): () => Promise<void> {
  return async () => {
    const http = inject(HttpClient);
    const tokenStore = inject(TokenStore);
    const currentUserStore = inject(CurrentUserStore);
    const apiConfig = inject(ApiConfiguration);
    const socketService = inject(QueueSocketService);
    const guestStore = inject(GuestStore);
    const router = inject(Router);

    // Boot check at root: redirect returning users without a full page reload cycle
    if (window.location.pathname === '/') {
      if (guestStore.hasToken() && !tokenStore.getRefreshToken()) {
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
      if (window.location.pathname === '/' && !sessionStorage.getItem(DASHBOARD_REDIRECT_KEY)) {
        sessionStorage.setItem(DASHBOARD_REDIRECT_KEY, '1');
        router.navigateByUrl('/dashboard');
      }
    } catch {
      tokenStore.clearTokens();
      currentUserStore.clear();
    }
  };
}
