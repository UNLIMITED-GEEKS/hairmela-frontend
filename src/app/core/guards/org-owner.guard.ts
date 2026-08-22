import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { OrgContextService } from '../salon-context/org-context.service';
import { CurrentUserStore } from '../auth/current-user.store';
import { RouteParam, RoutePath } from '../routing/route-paths';

// Uses OrgContextService's cache (ensureLoaded()) instead of its own raw
// GET /organizations/mine — that cache is already warmed eagerly on app boot
// (AuthShellComponent.ngOnInit) and shared with the Upgrade CTAs (frozen
// banner, tier banner, invite-staff), which already navigate here using
// membership.orgId with no round-trip of their own. Before this fix, EVERY
// entry into /org/:orgId/* re-fetched the owned-org list from scratch here —
// on prod that's real network latency stacked right after an otherwise-
// instant click, the "doesn't feel like an SPA" symptom. A warm cache now
// resolves synchronously; only a genuinely cold cache (e.g. a hard refresh
// landing directly on /org/:orgId) still makes a real request.
export const orgOwnerGuard: CanActivateFn = async (route) => {
  const orgContext = inject(OrgContextService);
  const currentUser = inject(CurrentUserStore);
  const router = inject(Router);

  const orgId = route.paramMap.get(RouteParam.ORG_ID);
  if (!orgId) {
    return router.createUrlTree(RoutePath.dashboard());
  }

  try {
    const org = orgContext.ownedOrg() ?? (await firstValueFrom(orgContext.ensureLoaded()));
    // Re-confirm ownership rather than trusting the id alone. OrgContextService
    // already resolves ownedOrg() by ownerId, so this is belt-and-braces — but
    // it is the check that actually enforces "owner", and keeping it here means
    // the guard cannot be silently weakened by a change to how that org is
    // selected upstream.
    const isOwner = org?.id === orgId && org?.ownerId === currentUser.user()?.id;
    return isOwner ? true : router.createUrlTree(RoutePath.dashboard());
  } catch {
    return router.createUrlTree(RoutePath.dashboard());
  }
};
