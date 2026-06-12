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
  {
    path: ':staffId/services',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('../../features/services/staff-service-assign/staff-service-assign.component').then(
        (m) => m.StaffServiceAssignComponent,
      ),
  },
  {
    path: ':staffId/schedules',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('../../features/schedules/weekly-schedule.component').then(
        (m) => m.WeeklyScheduleComponent,
      ),
  },
  {
    path: ':staffId/closures',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('../../features/closures/closures.component').then((m) => m.ClosuresComponent),
  },
];
