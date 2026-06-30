import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MembershipStore } from '../salon-context/membership.store';
import { OrgContextService } from '../salon-context/org-context.service';

export const tierGuard: CanActivateFn = async (route) => {
  const membershipStore = inject(MembershipStore);
  const orgContext = inject(OrgContextService);
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

    // Below the required tier → send to billing so the user can upgrade.
    // Owners can act on it; others land on the plan view and see the gate.
    const org = await firstValueFrom(orgContext.ensureLoaded());
    return org
      ? router.createUrlTree(['/org', org.id, 'billing'])
      : router.createUrlTree(['/dashboard']);
  } catch {
    return router.createUrlTree(['/dashboard']);
  }
};
