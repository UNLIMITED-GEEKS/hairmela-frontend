import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MembershipStore } from '../salon-context/membership.store';
import { SalonContextService } from '../salon-context/salon-context.service';
import { SalonRole } from '../salon-context/membership.types';
import { RouteParam, RoutePath } from '../routing/route-paths';
import { ToastService } from '../toast/toast.service';

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
  const salonContext = inject(SalonContextService);
  const router = inject(Router);

  // TEMPORARY DIAGNOSTIC — REMOVE ONCE THE iOS 15 NAVIGATION BUG IS FOUND.
  // Every redirect below is silent, which is why "nothing happens" on some
  // devices is impossible to tell apart from a dead button. These toasts name
  // which branch fired so an affected user can report it.
  const toast = inject(ToastService);

  const salonId = findSalonId(route);

  if (!salonId) {
    toast.error('DEBUG A: no salonId in route');
    return router.createUrlTree(RoutePath.dashboard());
  }

  const allowedRoles: SalonRole[] = route.data['roles'] ?? [];

  try {
    const membership = await firstValueFrom(membershipStore.getMembership(salonId));

    if (allowedRoles.length === 0 || allowedRoles.includes(membership.role)) {
      return true;
    }

    // CUSTOMER or insufficient role — redirect to dashboard
    toast.error(`DEBUG B: role ${membership.role} not in [${allowedRoles.join(',')}]`);
    return router.createUrlTree(RoutePath.dashboard());
  } catch (err) {
    // Couldn't load membership for this salon (not found, deleted, no longer
    // a member, etc). If this was the persisted "last visited" salon, clear
    // it — otherwise every future login redirects into the same dead salon
    // forever. No-ops if a different salon is persisted.
    const e = err as { status?: number; message?: string; name?: string };
    toast.error(
      `DEBUG C:: ${e?.name ?? 'err'} ${e?.status ?? ''} ${e?.message ?? ''}`.slice(0, 120),
    );
    salonContext.clearIfMatches(salonId);
    return router.createUrlTree(RoutePath.dashboard());
  }
};
