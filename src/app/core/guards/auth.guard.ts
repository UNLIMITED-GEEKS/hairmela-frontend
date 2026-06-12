import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenStore } from '../auth/token.store';

export const authGuard: CanActivateFn = (route) => {
  const tokenStore = inject(TokenStore);
  const router = inject(Router);

  if (tokenStore.isAuthenticated()) {
    return true;
  }

  const attempted = route.url.map((s) => s.path).join('/');
  return router.createUrlTree(['/login'], {
    queryParams: attempted ? { returnUrl: attempted } : {},
  });
};
