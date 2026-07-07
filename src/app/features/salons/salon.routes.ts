import { Routes } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { salonRoleGuard } from '../../core/guards/salon-role.guard';
import { tierGuard } from '../../core/guards/tier.guard';
import { SalonRole } from '../../core/salon-context/membership.types';

export const salonRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./salon-overview/salon-overview.component').then((m) => m.SalonOverviewComponent),
  },
  {
    path: 'settings',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./salon-settings/salon-settings.component').then((m) => m.SalonSettingsComponent),
  },
  {
    path: 'slug',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER] },
    loadComponent: () =>
      import('./salon-slug/salon-slug.component').then((m) => m.SalonSlugComponent),
  },
  {
    path: 'share',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('./salon-share/salon-share.component').then((m) => m.SalonShareComponent),
  },
  {
    path: 'delete',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER] },
    loadComponent: () =>
      import('./delete-salon/delete-salon.component').then((m) => m.DeleteSalonComponent),
  },
  {
    path: 'leave',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('./leave-salon/leave-salon.component').then((m) => m.LeaveSalonComponent),
  },
  {
    // Analytics is a Tier 2 (Pro) feature — role-gated AND tier-gated. Below
    // tier 2, tierGuard redirects to billing. The backend also returns
    // TIER_REQUIRED as the safety net.
    path: 'analytics',
    canActivate: [salonRoleGuard, tierGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN], requiredTier: 2 },
    // Chart.js (via ng2-charts) is only ever used here — registering it at the
    // route level keeps it out of the initial main.js bundle for everyone else.
    providers: [provideCharts(withDefaultRegisterables())],
    loadComponent: () =>
      import('./analytics/analytics.component').then((m) => m.AnalyticsComponent),
  },
  {
    path: 'media',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('./salon-media/salon-media.component').then((m) => m.SalonMediaComponent),
  },
  {
    path: 'closures',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadChildren: () =>
      import('../../features/closures/closures.routes').then((m) => m.closuresRoutes),
  },
  {
    path: 'services',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadChildren: () =>
      import('../../features/services/services.routes').then((m) => m.servicesRoutes),
  },
  {
    path: 'staff',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadChildren: () => import('../../features/staff/staff.routes').then((m) => m.staffRoutes),
  },
];
