import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenStore } from '../auth/token.store';

export const authGuard: CanActivateFn = () => {
  const tokenStore = inject(TokenStore);
  const router = inject(Router);

  if (tokenStore.isAuthenticated()) {
    return true;
  }

  const attempted = router.url;
  return router.createUrlTree(['/login'], {
    queryParams: attempted && attempted !== '/' ? { returnUrl: attempted } : {},
  });
};
