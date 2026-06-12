import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TokenStore } from './token.store';
import { CurrentUserStore } from './current-user.store';
import { ApiConfiguration } from '../../api/api-configuration';
import { authenticatedAuthControllerGetMe } from '../../api/fn/auth/authenticated-auth-controller-get-me';

export function sessionInit(): () => Promise<void> {
  return async () => {
    const http = inject(HttpClient);
    const tokenStore = inject(TokenStore);
    const currentUserStore = inject(CurrentUserStore);
    const apiConfig = inject(ApiConfiguration);

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
    } catch {
      tokenStore.clearTokens();
      currentUserStore.clear();
    }
  };
}
