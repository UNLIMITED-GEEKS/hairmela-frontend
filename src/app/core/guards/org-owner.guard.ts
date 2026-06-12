import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { organizationsControllerFindMine } from '../../api/fn/organizations/organizations-controller-find-mine';

export const orgOwnerGuard: CanActivateFn = async (route) => {
  const http = inject(HttpClient);
  const apiConfig = inject(ApiConfiguration);
  const router = inject(Router);

  const orgId = route.paramMap.get('orgId');
  if (!orgId) {
    return router.createUrlTree(['/dashboard']);
  }

  try {
    const orgs = await firstValueFrom(
      organizationsControllerFindMine(http, apiConfig.rootUrl).pipe(
        map((res) => res.body),
      ),
    );

    const owns = Array.isArray(orgs) && orgs.some((o) => o.id === orgId);
    return owns ? true : router.createUrlTree(['/dashboard']);
  } catch {
    return router.createUrlTree(['/dashboard']);
  }
};
