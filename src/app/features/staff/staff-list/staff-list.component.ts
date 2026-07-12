import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe, LowerCasePipe } from '@angular/common';
import { SalonStaff } from '../../../api/models/salon-staff';
import { PendingInviteDto } from '../../../api/models/pending-invite-dto';
import { StaffService } from '../staff.service';
import { HasRoleDirective } from '../../../shared/directives/has-role.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ScreenLayoutComponent } from '../../../shared/components/screen-layout/screen-layout.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteParam, RoutePath, RouteSegment } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-staff-list',
  templateUrl: './staff-list.component.html',
  imports: [
    RouterLink,
    HasRoleDirective,
    SkeletonComponent,
    DatePipe,
    LowerCasePipe,
    ScreenLayoutComponent,
    PageHeaderComponent,
  ],
})
export class StaffListComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _staffService = inject(StaffService);

  protected readonly staffList = this._staffService.staffList;
  protected readonly loading = this._staffService.loading;
  protected readonly error = this._staffService.error;
  protected readonly invites = this._staffService.invites;

  protected readonly inviteLink = [RouteSegment.INVITE];

  protected get salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected queueConsoleLink(queueId: string): string[] {
    return RoutePath.salonQueueConsole(this.salonId, queueId);
  }

  ngOnInit(): void {
    this._staffService.load(this.salonId);
    this._staffService.loadInvites(this.salonId);
  }

  protected retry(): void {
    this._staffService.refresh(this.salonId);
  }

  protected cancelInvite(invite: PendingInviteDto): void {
    this._staffService.cancelInvite(this.salonId, invite.staffId);
  }

  protected roleBadgeClass(role: SalonStaff['role']): string {
    const map: Record<SalonStaff['role'], string> = {
      OWNER: 'bg-primary/10 text-primary',
      ADMIN: 'bg-blue-100 text-blue-700',
      STAFF: 'bg-gray-100 text-gray-600',
    };
    return map[role];
  }

  protected statusBadgeClass(status: SalonStaff['status']): string {
    const map: Record<SalonStaff['status'], string> = {
      ACTIVE: 'bg-green-100 text-green-700',
      PENDING: 'bg-amber-100 text-amber-700',
      INACTIVE: 'bg-gray-100 text-gray-500',
    };
    return map[status];
  }

  protected staffName(s: SalonStaff): string {
    if (s.user) return `${s.user.firstName} ${s.user.lastName}`;
    return s.email;
  }
}
