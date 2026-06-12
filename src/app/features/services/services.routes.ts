import { Routes } from '@angular/router';
import { salonRoleGuard } from '../../core/guards/salon-role.guard';
import { SalonRole } from '../../core/salon-context/membership.types';

export const servicesRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./service-list/service-list.component').then((m) => m.ServiceListComponent),
  },
  {
    path: 'new',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./service-form/service-form.component').then((m) => m.ServiceFormComponent),
  },
  {
    path: ':serviceId/edit',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./service-form/service-form.component').then((m) => m.ServiceFormComponent),
  },
];
