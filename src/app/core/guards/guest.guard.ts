import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenStore } from '../auth/token.store';

export const guestGuard: CanActivateFn = () => {
  const tokenStore = inject(TokenStore);
  const router = inject(Router);

  if (tokenStore.isAuthenticated()) {
    return router.createUrlTree(['/dashboard']);
  }

  return true;
};
