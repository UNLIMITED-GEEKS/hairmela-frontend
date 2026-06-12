import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TokenStore } from '../auth/token.store';
import { environment } from '../../../environments/environment';

const SKIP_AUTH_PATHS = [
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/refresh',
];

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenStore = inject(TokenStore);

  const isApiRequest = req.url.startsWith(environment.apiBaseUrl);
  const isSkipped = SKIP_AUTH_PATHS.some((path) => req.url.includes(path));

  if (!isApiRequest || isSkipped) {
    return next(req);
  }

  const token = tokenStore.getAccessToken();
  if (!token) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
