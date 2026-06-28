import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { userSalonsControllerFindMine } from '../../api/fn/salons/user-salons-controller-find-mine';

// Allows /salons/new for users who can actually own a salon: either a brand-new
// user with no salons yet, or someone who already owns at least one. Users who
// are ONLY staff/admin (and own nothing) are redirected to the dashboard.
// Roles are per-salon, so "owner" means an OWNER entry in GET /salons/mine.
export const canCreateSalonGuard: CanActivateFn = async () => {
  const http = inject(HttpClient);
  const apiConfig = inject(ApiConfiguration);
  const router = inject(Router);

  try {
    const salons = await firstValueFrom(
      userSalonsControllerFindMine(http, apiConfig.rootUrl).pipe(map((res) => res.body)),
    );

    const isNewUser = salons.length === 0;
    const ownsASalon = salons.some((s) => s.role === 'OWNER');
    return isNewUser || ownsASalon ? true : router.createUrlTree(['/dashboard']);
  } catch {
    return router.createUrlTree(['/dashboard']);
  }
};
