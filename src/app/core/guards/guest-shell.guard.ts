import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenStore } from '../auth/token.store';
import { GuestStore } from '../guest/guest-store';

export const guestShellGuard: CanActivateFn = () => {
  const tokenStore = inject(TokenStore);
  const guestStore = inject(GuestStore);
  const router = inject(Router);

  // Block logged-in users from the guest shell
  if (tokenStore.isAuthenticated()) {
    return router.createUrlTree(['/']);
  }

  // Allow both guest-token users and fully unauthenticated users
  return true;
};
