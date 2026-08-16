import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenStore } from '../auth/token.store';
import { AppPlatformService } from '../native/app-platform.service';
import { RoutePath } from '../routing/route-paths';

// Keeps a signed-in user off "/" ONLY when running as an installed app, where
// "/" is the signed-out welcome screen and showing it to someone already
// logged in makes no sense.
//
// On web "/" is the marketing site, which a signed-in user is perfectly
// entitled to visit — so this deliberately does nothing there. Using the plain
// guestGuard here would have changed that long-standing web behaviour.
//
// Fully synchronous: TokenStore.isAuthenticated() is a computed over an
// in-memory signal, so there is no network call and no visible lag. Auth state
// is already settled by this point because sessionInit is an app initializer
// and completes before any route activates.
export const appHomeGuestGuard: CanActivateFn = () => {
  const platform = inject(AppPlatformService);
  if (!platform.isAppContext) return true;

  const tokenStore = inject(TokenStore);
  const router = inject(Router);
  return tokenStore.isAuthenticated() ? router.createUrlTree(RoutePath.dashboard()) : true;
};
