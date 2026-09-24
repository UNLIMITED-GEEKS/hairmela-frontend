import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TokenStore } from '../auth/token.store';
import { GuestStore } from '../guest/guest-store';
import { environment } from '../../../environments/environment';

const SKIP_AUTH_PATHS = [
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/refresh',
  '/v1/media/presign-upload',
  '/v1/media/ad-hoc-upload',
];

// Routes where an anonymous caller is identified by a stored guest token (the
// backend's FlexAuthGuard accepts it). Scoped narrowly so a guest token is
// never sent to genuinely-protected endpoints.
const GUEST_TOKEN_PATHS = [
  '/walk-in',
  '/appointments',
  '/receipt-verification',
  '/queues/guest-entries',
  '/queues/my-entries',
  '/entries/',
  '/push/subscribe',
  '/comments',
];

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenStore = inject(TokenStore);
  const guestStore = inject(GuestStore);

  const isApiRequest = req.url.startsWith(environment.apiBaseUrl);
  const isSkipped = SKIP_AUTH_PATHS.some((path) => req.url.includes(path));

  if (!isApiRequest || isSkipped) {
    return next(req);
  }

  // User JWT always wins.
  const token = tokenStore.getAccessToken();
  if (token) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  }

  // No user session: fall back to the guest token on guest-eligible routes only.
  const isGuestRoute = GUEST_TOKEN_PATHS.some((path) => req.url.includes(path));
  const guestToken = guestStore.getToken();
  if (isGuestRoute && guestToken) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${guestToken}` } }));
  }

  return next(req);
};
