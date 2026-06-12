import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MembershipStore } from '../salon-context/membership.store';
import { SalonRole } from '../salon-context/membership.types';

export const salonRoleGuard: CanActivateFn = async (route) => {
  const membershipStore = inject(MembershipStore);
  const router = inject(Router);

  const salonId = route.paramMap.get('salonId') ??
    route.parent?.paramMap.get('salonId');

  if (!salonId) {
    return router.createUrlTree(['/dashboard']);
  }

  const allowedRoles: SalonRole[] = route.data['roles'] ?? [];

  try {
    const membership = await firstValueFrom(membershipStore.getMembership(salonId));

    if (allowedRoles.length === 0 || allowedRoles.includes(membership.role)) {
      return true;
    }

    // CUSTOMER or insufficient role — redirect to dashboard
    return router.createUrlTree(['/dashboard']);
  } catch {
    return router.createUrlTree(['/dashboard']);
  }
};
