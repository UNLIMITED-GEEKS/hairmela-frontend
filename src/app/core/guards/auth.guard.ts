import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { TokenStore } from '../auth/token.store';
import { GuestStore } from '../guest/guest-store';
import { RoutePath, RouteQueryParam, RouteSegment } from '../routing/route-paths';

export const authGuard: CanActivateFn = (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const tokenStore = inject(TokenStore);
  const guestStore = inject(GuestStore);
  const router = inject(Router);

  if (tokenStore.isAuthenticated()) return true;

  const attempted = state.url;

  // Refresh token present = user has an account; session init will restore it — send to login
  if (tokenStore.getRefreshToken()) {
    return router.createUrlTree(RoutePath.login(), {
      queryParams: attempted && attempted !== '/' ? { [RouteQueryParam.RETURN_URL]: attempted } : {},
    });
  }

  // No account at all — salon visit pages go to guest shell
  if (attempted.startsWith(`/${RouteSegment.S}/`)) {
    return router.createUrlTree([`/${RouteSegment.G}${attempted}`]);
  }

  // Guest token only — they can browse guest routes
  if (guestStore.hasToken()) {
    return router.createUrlTree(RoutePath.guestQueues());
  }

  return router.createUrlTree(RoutePath.login(), {
    queryParams: attempted && attempted !== '/' ? { [RouteQueryParam.RETURN_URL]: attempted } : {},
  });
};
