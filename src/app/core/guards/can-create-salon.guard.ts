import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SalonsStore } from '../salon-context/salons.store';
import { SalonRole } from '../salon-context/membership.types';
import { RoutePath } from '../routing/route-paths';

// Allows /salons/new for users who can actually own a salon: either a brand-new
// user with no salons yet, or someone who already owns at least one. Users who
// are ONLY staff/admin (and own nothing) are redirected to the dashboard.
// Roles are per-salon, so "owner" means an OWNER entry in GET /salons/mine.
//
// Reuses SalonsStore's cached/in-flight salons list (ensureLoaded())
// instead of issuing its own duplicate GET /salons/mine — by the time a user
// reaches this route (from the dashboard, account page, or sidebar), that
// data is almost always already loaded, so this resolves instantly instead
// of blocking navigation on a redundant network round-trip.
export const canCreateSalonGuard: CanActivateFn = async () => {
  const dashboardService = inject(SalonsStore);
  const router = inject(Router);

  try {
    const salons = await firstValueFrom(dashboardService.ensureLoaded());

    const isNewUser = salons.length === 0;
    const ownsASalon = salons.some((s) => s.role === SalonRole.OWNER);
    return isNewUser || ownsASalon ? true : router.createUrlTree(RoutePath.dashboard());
  } catch {
    return router.createUrlTree(RoutePath.dashboard());
  }
};
