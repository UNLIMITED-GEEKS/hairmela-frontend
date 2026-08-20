import { Component, OnInit, inject, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SalonOverviewService } from './salon-overview.service';
import { InvitesService } from '../../dashboard/invites.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { NoPhotoBannerComponent } from '../../../shared/components/no-photo-banner/no-photo-banner.component';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { TierBannerComponent } from '../../../shared/components/tier-banner/tier-banner.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ToastService } from '../../../core/toast/toast.service';
import { RouteParam, RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-salon-overview',
  templateUrl: './salon-overview.component.html',
  imports: [RouterLink, SkeletonComponent, FrozenBannerComponent, TierBannerComponent, IconComponent, NoPhotoBannerComponent],
})
export class SalonOverviewComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _salonOverviewService = inject(SalonOverviewService);
  private readonly _invitesService = inject(InvitesService);
  private readonly _toast = inject(ToastService);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly salon = this._salonOverviewService.salon;
  protected readonly myStaff = this._salonOverviewService.myStaff;
  protected readonly loading = this._salonOverviewService.loading;
  protected readonly error = this._salonOverviewService.error;
  protected readonly invites = this._invitesService.invites;

  protected readonly isOwnerOrAdmin = computed(() => {
    const role = this.myStaff()?.role;
    return role === SalonRole.OWNER || role === SalonRole.ADMIN;
  });

  protected readonly isStaff = computed(() => this.myStaff()?.role === SalonRole.STAFF);

  protected readonly howItWorksLink = RoutePath.howItWorks();

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  ngOnInit(): void {
    const userId = this._currentUser.user()?.id ?? '';
    this._salonOverviewService.load(this._salonId, userId);
    this._invitesService.load();

    if (!this.salon() && !this.loading()) {
      this._router.navigate(RoutePath.dashboard());
    }
  }

  protected retry(): void {
    const userId = this._currentUser.user()?.id ?? '';
    this._salonOverviewService.refresh(this._salonId, userId);
  }

  protected toggleAcceptingClients(): void {
    const staffId = this.myStaff()?.id;
    if (staffId) this._salonOverviewService.toggleAcceptingClients(this._salonId, staffId);
  }

  protected acceptInvite(invite: ReturnType<typeof this.invites>[number]): void {
    this._invitesService.accept(invite);
  }

  protected declineInvite(invite: ReturnType<typeof this.invites>[number]): void {
    this._invitesService.decline(invite);
  }

  protected queueConsoleLink(salonId: string, queueId: string): string[] {
    return RoutePath.salonQueueConsole(salonId, queueId);
  }

  // The public link customers use to join THIS staff member's queue — same
  // /s/{slug}/q/{queueId} shape live-queue's own "Copy queue link" copies,
  // built with no shell prefix since it's meant to be shared with someone
  // else, who should land fresh and get routed by their own session.
  protected copyMyQueueLink(slug: string, queueId: string): void {
    const path = RoutePath.visitQueue('', slug, queueId).join('/');
    navigator.clipboard
      .writeText(`${environment.appBaseUrl}${path}`)
      .then(() => this._toast.success('Queue link copied'))
      .catch(() => this._toast.error('Could not copy link'));
  }

  protected staffLink(salonId: string): string[] {
    return RoutePath.salonStaff(salonId);
  }

  protected servicesLink(salonId: string): string[] {
    return RoutePath.salonServices(salonId);
  }

  // "My Services" on the staff-facing grid — a staff member's own assigned
  // services, not the salon-wide manage-services list servicesLink() points
  // owners/admins at.
  protected myServicesLink(salonId: string, staffId: string): string[] {
    return RoutePath.salonStaffServices(salonId, staffId);
  }

  protected settingsLink(salonId: string): string[] {
    return RoutePath.salonSettings(salonId);
  }

  protected analyticsLink(salonId: string): string[] {
    return RoutePath.salonAnalytics(salonId);
  }

  protected shareLink(salonId: string): string[] {
    return RoutePath.salonShare(salonId);
  }

  // Shortcut to the current user's OWN staff photos — any role (owner, admin,
  // staff) has a myStaff() record here, so this needs no role check. Without
  // it, updating your own photos meant going through Staff -> your own row ->
  // Media, even though you're looking at your own overview page already.
  protected myPhotosLink(salonId: string, staffId: string): string[] {
    return RoutePath.salonStaffMedia(salonId, staffId);
  }

  protected closuresLink(salonId: string): string[] {
    return RoutePath.salonClosures(salonId);
  }

  protected staffAppointmentsLink(salonId: string, staffId: string): string[] {
    return RoutePath.salonStaffAppointments(salonId, staffId);
  }

  protected newBranchLink(): string[] {
    return RoutePath.newSalon();
  }

  protected newBranchQueryParams(salonId: string, salonName: string): Record<string, string> {
    return {
      [RouteQueryParam.PARENT_SALON_ID]: salonId,
      [RouteQueryParam.PARENT_SALON_NAME]: salonName,
    };
  }
}
