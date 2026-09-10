import { SalonRole } from '../../core/salon-context/membership.types';
import { RouteParam, RouteSegment } from '../../core/routing/route-paths';
import { staffRoutes } from './staff.routes';

describe('staffRoutes', () => {
  it('matches the owner-only transfer route before the dynamic staff detail route', () => {
    const transferIndex = staffRoutes.findIndex(
      (route) => route.path === RouteSegment.TRANSFER_OWNERSHIP,
    );
    const detailIndex = staffRoutes.findIndex((route) => route.path === `:${RouteParam.STAFF_ID}`);
    const transferRoute = staffRoutes[transferIndex];

    expect(transferIndex).toBeGreaterThanOrEqual(0);
    expect(transferIndex).toBeLessThan(detailIndex);
    expect(transferRoute.data?.['roles']).toEqual([SalonRole.OWNER]);
    expect(transferRoute.canActivate).toBeTruthy();
    expect(transferRoute.loadComponent).toBeTruthy();
  });
});
