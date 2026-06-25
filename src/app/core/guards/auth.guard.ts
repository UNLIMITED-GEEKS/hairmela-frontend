import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { TokenStore } from '../auth/token.store';
import { GuestStore } from '../guest/guest-store';

export const authGuard: CanActivateFn = (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const tokenStore = inject(TokenStore);
  const guestStore = inject(GuestStore);
  const router = inject(Router);

  if (tokenStore.isAuthenticated()) return true;

  const attempted = state.url;

  // Refresh token present = user has an account; session init will restore it — send to login
  if (tokenStore.getRefreshToken()) {
    return router.createUrlTree(['/login'], {
      queryParams: attempted && attempted !== '/' ? { returnUrl: attempted } : {},
    });
  }

  // No account at all — salon visit pages go to guest shell
  if (attempted.startsWith('/s/')) {
    return router.createUrlTree([`/g${attempted}`]);
  }

  // Guest token only — they can browse guest routes
  if (guestStore.hasToken()) {
    return router.createUrlTree(['/g/queues']);
  }

  return router.createUrlTree(['/login'], {
    queryParams: attempted && attempted !== '/' ? { returnUrl: attempted } : {},
  });
};
