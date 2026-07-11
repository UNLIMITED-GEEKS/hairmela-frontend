import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MembershipStore } from '../salon-context/membership.store';
import { SalonRole } from '../salon-context/membership.types';
import { RouteParam, RoutePath } from '../routing/route-paths';

function findSalonId(route: ActivatedRouteSnapshot): string | null {
  let r: ActivatedRouteSnapshot | null = route;
  while (r) {
    const id = r.paramMap.get(RouteParam.SALON_ID);
    if (id) return id;
    r = r.parent;
  }
  return null;
}

export const salonRoleGuard: CanActivateFn = async (route) => {
  const membershipStore = inject(MembershipStore);
  const router = inject(Router);

  const salonId = findSalonId(route);

  if (!salonId) {
    return router.createUrlTree(RoutePath.dashboard());
  }

  const allowedRoles: SalonRole[] = route.data['roles'] ?? [];

  try {
    const membership = await firstValueFrom(membershipStore.getMembership(salonId));

    if (allowedRoles.length === 0 || allowedRoles.includes(membership.role)) {
      return true;
    }

    // CUSTOMER or insufficient role — redirect to dashboard
    return router.createUrlTree(RoutePath.dashboard());
  } catch {
    return router.createUrlTree(RoutePath.dashboard());
  }
};
