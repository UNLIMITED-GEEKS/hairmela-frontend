import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { TokenStore } from '../auth/token.store';
import { RoutePath } from '../routing/route-paths';
import { toAuthShellTree } from '../routing/shell-url';

export const guestShellGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const tokenStore = inject(TokenStore);
  const router = inject(Router);

  // Logged-in users don't belong in the guest shell — but they usually got
  // here from a link someone shared with them (/g/s/:slug), so send them to
  // the SAME page in the auth shell rather than dropping them on the home
  // page and losing the salon they were sent to.
  //
  // The /g ↔ '' mapping lives in shell-url.ts, shared with authGuard, which
  // applies it in the opposite direction.
  if (tokenStore.isAuthenticated()) {
    // parseUrl gives us a tree we solely own, which toAuthShellTree mutates.
    return toAuthShellTree(router.parseUrl(state.url)) ?? router.createUrlTree(RoutePath.root());
  }

  // Allow both guest-token users and fully unauthenticated users
  return true;
};
