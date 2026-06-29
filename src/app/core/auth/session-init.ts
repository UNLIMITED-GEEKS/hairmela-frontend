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

      // Redirect to dashboard only on cold start at root
      if (window.location.pathname === '/') {
        router.navigateByUrl('/dashboard');
      }
    } catch {
      tokenStore.clearTokens();
      currentUserStore.clear();
    }
  };
}
