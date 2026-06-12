import { Routes } from '@angular/router';
import { salonRoleGuard } from '../../core/guards/salon-role.guard';
import { SalonRole } from '../../core/salon-context/membership.types';

export const staffRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./staff-list/staff-list.component').then((m) => m.StaffListComponent),
  },
  {
    path: 'invite',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./invite-staff/invite-staff.component').then((m) => m.InviteStaffComponent),
  },
  {
    path: ':staffId',
    loadComponent: () =>
      import('./staff-detail/staff-detail.component').then((m) => m.StaffDetailComponent),
  },
  {
    path: ':staffId/media',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./staff-media/staff-media.component').then((m) => m.StaffMediaComponent),
  },
];
