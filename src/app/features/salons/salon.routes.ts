import { Routes } from '@angular/router';
import { salonRoleGuard } from '../../core/guards/salon-role.guard';
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
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
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
    path: 'staff',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadChildren: () =>
      import('../../features/staff/staff.routes').then((m) => m.staffRoutes),
  },
];
