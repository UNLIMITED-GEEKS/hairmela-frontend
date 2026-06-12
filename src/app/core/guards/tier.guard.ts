import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MembershipStore } from '../salon-context/membership.store';

export const tierGuard: CanActivateFn = async (route) => {
  const membershipStore = inject(MembershipStore);
  const router = inject(Router);

  const salonId = route.paramMap.get('salonId') ??
    route.parent?.paramMap.get('salonId');

  if (!salonId) {
    return router.createUrlTree(['/dashboard']);
  }

  const requiredTier: number = route.data['requiredTier'] ?? 1;

  try {
    const membership = await firstValueFrom(membershipStore.getMembership(salonId));

    if (membership.tier >= requiredTier) {
      return true;
    }

    // Redirect to org plan explainer — orgId comes from membership if available
    return router.createUrlTree(['/dashboard']);
  } catch {
    return router.createUrlTree(['/dashboard']);
  }
};
