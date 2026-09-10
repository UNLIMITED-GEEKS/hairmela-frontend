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
    path: RouteSegment.TRANSFER_OWNERSHIP,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER] },
    loadComponent: () =>
      import('./transfer-ownership/transfer-ownership.component').then(
        (m) => m.TransferOwnershipComponent,
      ),
  },
  {
    path: `:${RouteParam.STAFF_ID}`,
    loadComponent: () =>
      import('./staff-detail/staff-detail.component').then((m) => m.StaffDetailComponent),
  },
  {
    // STAFF is allowed here so a staff member can reach their own photos
    // page — but StaffMediaComponent.canEdit() doesn't yet scope to "is this
    // MY staffId" (that requires resolving the SalonStaff.userId behind this
    // staffId and comparing to CurrentUserStore, not done yet — see its own
    // comment). Until that lands, a STAFF role can view any staff member's
    // media page here, upload only disabled for non-owner/admin regardless.
    path: `:${RouteParam.STAFF_ID}/${RouteSegment.MEDIA}`,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
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
  {
    // A staff member can view their own appointment history here too — same
    // role set as :staffId/services (staff manage their own booked schedule).
    path: `:${RouteParam.STAFF_ID}/${RouteSegment.APPOINTMENTS}`,
    canActivate: [salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('../../features/salons/appointments/appointments-list.component').then(
        (m) => m.AppointmentsListComponent,
      ),
  },
];
