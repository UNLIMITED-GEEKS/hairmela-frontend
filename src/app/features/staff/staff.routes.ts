import { Routes } from '@angular/router';
import { salonRoleGuard } from '../../core/guards/salon-role.guard';
import { SalonRole } from '../../core/salon-context/membership.types';
import { RouteParam, RouteSegment } from '../../core/routing/route-paths';

export const staffRoutes: Routes = [
  {
    // FIXME: blocking the staff list for STAFF removes their only UI path to
    // their own service-assignment page (list -> my detail -> services). STAFF
    // are meant to manage their own services (see CLAUDE.md); add a direct path
    // (e.g. dashboard "My Services" -> /staff/:myStaffId/services) before relying
    // on this. The :staffId/services route still allows STAFF — only the link is gone.
    path: '',
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./staff-list/staff-list.component').then((m) => m.StaffListComponent),
  },
  {
    path: RouteSegment.INVITE,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./invite-staff/invite-staff.component').then((m) => m.InviteStaffComponent),
  },
  {
    path: `:${RouteParam.STAFF_ID}`,
    loadComponent: () =>
      import('./staff-detail/staff-detail.component').then((m) => m.StaffDetailComponent),
  },
  {
    path: `:${RouteParam.STAFF_ID}/${RouteSegment.MEDIA}`,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('./staff-media/staff-media.component').then((m) => m.StaffMediaComponent),
  },
  {
    path: `:${RouteParam.STAFF_ID}/${RouteSegment.SERVICES}`,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('../../features/services/staff-service-assign/staff-service-assign.component').then(
        (m) => m.StaffServiceAssignComponent,
      ),
  },
  {
    path: `:${RouteParam.STAFF_ID}/${RouteSegment.SCHEDULES}`,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('../../features/schedules/weekly-schedule.component').then(
        (m) => m.WeeklyScheduleComponent,
      ),
  },
  {
    path: `:${RouteParam.STAFF_ID}/${RouteSegment.CLOSURES}`,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN] },
    loadComponent: () =>
      import('../../features/closures/closures.component').then((m) => m.ClosuresComponent),
  },
];
