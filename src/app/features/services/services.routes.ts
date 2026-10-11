import { Routes } from '@angular/router';
import { salonRoleGuard } from '../../core/guards/salon-role.guard';
import { SalonRole } from '../../core/salon-context/membership.types';
import { RouteParam, RouteSegment } from '../../core/routing/route-paths';

export const servicesRoutes: Routes = [
  {
    path: '',
    title: 'Services',
    loadComponent: () =>
      import('./service-list/service-list.component').then((m) => m.ServiceListComponent),
  },
  {
    path: RouteSegment.NEW,
    title: 'New service',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./service-form/service-form.component').then((m) => m.ServiceFormComponent),
  },
  {
    path: `:${RouteParam.SERVICE_ID}/${RouteSegment.EDIT}`,
    title: 'Edit service',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./service-form/service-form.component').then((m) => m.ServiceFormComponent),
  },
];
