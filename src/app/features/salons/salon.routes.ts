import { Routes } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { salonRoleGuard } from '../../core/guards/salon-role.guard';
import { SalonRole } from '../../core/salon-context/membership.types';
import { RouteSegment } from '../../core/routing/route-paths';

export const salonRoutes: Routes = [
  {
    path: '',
    title: 'Salon Overview',
    loadComponent: () =>
      import('./salon-overview/salon-overview.component').then((m) => m.SalonOverviewComponent),
  },
  {
    path: RouteSegment.SETTINGS,
    title: 'Salon Settings',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./salon-settings/salon-settings.component').then((m) => m.SalonSettingsComponent),
  },
  {
    path: RouteSegment.SLUG_EDIT,
    title: 'Salon URL',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER] },
    loadComponent: () =>
      import('./salon-slug/salon-slug.component').then((m) => m.SalonSlugComponent),
  },
  {
    path: RouteSegment.SHARE,
    title: 'Share your salon',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('./salon-share/salon-share.component').then((m) => m.SalonShareComponent),
  },
  {
    path: RouteSegment.DELETE,
    title: 'Delete Salon',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER] },
    loadComponent: () =>
      import('./delete-salon/delete-salon.component').then((m) => m.DeleteSalonComponent),
  },
  {
    path: RouteSegment.LEAVE,
    title: 'Leave Salon',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('./leave-salon/leave-salon.component').then((m) => m.LeaveSalonComponent),
  },
  {
    // Analytics is available on every tier — role-gated only.
    path: RouteSegment.ANALYTICS,
    title: 'Analytics',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    // Chart.js (via ng2-charts) is only ever used here — registering it at the
    // route level keeps it out of the initial main.js bundle for everyone else.
    providers: [provideCharts(withDefaultRegisterables())],
    loadComponent: () =>
      import('./analytics/analytics.component').then((m) => m.AnalyticsComponent),
  },
  {
    path: RouteSegment.MY_ANALYTICS,
    title: 'My analytics',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    providers: [provideCharts(withDefaultRegisterables())],
    loadComponent: () =>
      import('./analytics/my-analytics.component').then((m) => m.MyAnalyticsComponent),
  },
  {
    path: RouteSegment.MEDIA,
    title: 'Salon Photos',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('./salon-media/salon-media.component').then((m) => m.SalonMediaComponent),
  },
  {
    path: RouteSegment.CLOSURES,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadChildren: () =>
      import('../../features/closures/closures.routes').then((m) => m.closuresRoutes),
  },
  {
    path: RouteSegment.SERVICES,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadChildren: () =>
      import('../../features/services/services.routes').then((m) => m.servicesRoutes),
  },
  {
    path: RouteSegment.STAFF,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadChildren: () => import('../../features/staff/staff.routes').then((m) => m.staffRoutes),
  },
  {
    // Whole-salon appointment history — owner/admin only, matching the
    // backend guard on GET /salons/:salonId/appointments (staff only see
    // their own via the :staffId/appointments route under staffRoutes).
    path: RouteSegment.APPOINTMENTS,
    title: 'All Appointments',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./appointments/appointments-list.component').then((m) => m.AppointmentsListComponent),
  },
];
